# Release Notes

## [0.9.17] — 2026-06-26 — Fix stage1 timeout + URL construction + progress bar

### Fixed
- `app/api/enrich/run/[jobId]/route.ts` — removed `await` from `runStage1()` call; the await kept the HTTP request open until stage1 finished, causing Railway to kill it after ~30s and terminate mid-run enrichment; now fires fire-and-forget and returns `{ started: true }` immediately
- `app/api/enrich/upload/route.ts` — removed `x-forwarded-host` and `env.NEXT_PUBLIC_APP_URL` from run-route URL construction; Railway's forwarded host was unreliable; now uses `request.headers.get('host')` directly with `localhost` detection for protocol
- `app/page.tsx` — stage 2 progress bar was always showing stage 1 ratio (`stage1_matched / total_rows`); fixed by computing `progressPct` from `progressValue`/`progressMax` which switch to `stage2_enriched / stage1_matched` when in stage 2

### Changed
- `app/api/enrich/status/[jobId]/route.ts` — added server-side logging per poll (`stage1_status`, `stage1_matched`, `total_rows`, row count) to make Railway log diagnostics easier

## [0.9.16] — 2026-05-26 — Hybrid Zillow lookup: local table first, external API fallback

### Changed
- `lib/enrichment/zillowMatcher.ts` — added `searchLocalTable()`: queries `staging.zillow_agent_profiles` (781k rows) via new `ce_search_zillow_candidates` RPC filtered by state + `is_team=true`; returns `ZillowResult[]` for app-side scoring; any RPC error falls through to API silently
- Same file — `findZillowUrl()` now tries local table before external API when state is known; if table yields no match above gates, falls back to API; if no state is parseable, skips table and goes straight to API
- Same file — fixed scoring bug: `business_name` removed from `Math.max()` in name scoring; `business_name` is the brokerage affiliation and must never be scored against the team name; name scoring now uses only `team_name` and `full_name`
- Same file — `displayName` order fixed: `team_name ?? full_name ?? business_name`; previously `team_name ?? business_name ?? full_name` put the brokerage before the display name
- Same file — `ZillowResult` type extended with `team_size?: number | null`; `isTeamRecord` updated to check `team_size > 1`
- Same file — `attemptSearch` and `searchWithFallback` now accept `state: string | null`; when state is null the `state=` param is omitted from the API request
- Same file — `FindZillowResult` adds `source: 'table' | 'api' | 'none'`; `rejection_reason` removes `no_state` (no-state rows now try API instead of hard-rejecting)
- Same file — scoring logic extracted into `scoreAndPick()` helper used by both table and API paths; one scorer for both sources
- `app/api/zillow-finder/run/route.ts` — `ResultRow` extended with `source: string`
- `app/page.tsx` — `ZfResultRow` extended with `source`; CSV download adds `Source` column

### Added
- `supabase/migrations/20260526100000_ce_search_zillow_candidates.sql` — `ce_search_zillow_candidates(p_state, p_is_team)` SECURITY DEFINER RPC; filters `staging.zillow_agent_profiles` by state and `is_team` flag; `LIMIT 2000` caps the result set; **must be applied in Supabase dashboard**

### Schema changes (apply in Supabase dashboard)
Run `supabase/migrations/20260526100000_ce_search_zillow_candidates.sql`

## [0.9.14] — 2026-05-26 — Standalone Zillow URL finder + shared matcher module + staging table migration

### Added
- `lib/enrichment/zillowMatcher.ts` — extracted all Zillow matching logic into a shared module (`findZillowUrl`, `calcNameScore`, `calcBrokerageScore`, `isTeamRecord`, `sanitizeQuery`, `parseState`, retry/backoff cascade, chain hard-reject, full_name scoring); both `find-zillow-url/route.ts` and the new finder route import from here — no duplication
- `app/api/zillow-finder/run/route.ts` — new stateless POST route; Zod-validates `{ rows: Array<{mad_id, team_name, brokerage, location}> }` (1–50 rows); processes all rows with `Promise.allSettled`; returns `{ data: { results: [...] } }` with `zillow_url`, `match_score`, `matched_name`, `rejection_reason` per row; zero Supabase imports or DB calls
- Dashboard: "Zillow URL Finder (standalone)" section — PapaParse client-side header validation, sends rows in batches of 5 with live `Processing row X of N…` progress bar, client-side CSV generation (`zillow-finder-results-{timestamp}.csv`), match summary on completion
- `supabase/migrations/20260526000000_create_staging_batch_tables.sql` — creates `staging.batches`, `staging.teams`, `staging.agents`, `staging.pipeline_log` with column names matching all `ce_*` RPCs; includes unique expression index on `staging.agents(team_id, COALESCE(lower(first_name),''), COALESCE(lower(last_name),''))` required by `ce_insert_agents_bulk ON CONFLICT`

### Changed
- `app/api/company-enrichment/find-zillow-url/route.ts` — refactored to 35 lines; imports `findZillowUrl` from shared module; behavior unchanged
- `app/api/company-enrichment/start/route.ts` — improved error logging: `JSON.stringify(batchErr)` and `JSON.stringify(teamsErr)` instead of `.message` only, exposing Postgres `code`/`details`/`hint` in Railway logs

### Schema changes (apply in Supabase dashboard — run migration SQL)
`staging.batches`, `staging.teams`, `staging.agents`, `staging.pipeline_log` — see migration file

## [0.9.13] — 2026-05-20 — Score full_name alongside team_name and business_name in Zillow matcher

### Fixed
- `app/api/company-enrichment/find-zillow-url/route.ts` — added `calcNameScore(team_name, r.full_name ?? '')` as a third term in the `ns = Math.max(...)` calculation; `full_name` is Zillow's public profile display name and frequently contains the actual team name; when Zillow stores the team name in `full_name` only (e.g. lead's personal name is in `team_name`, team display name is in `full_name`), the previous code scored 0 and falsely rejected; no thresholds, gates, normalization, or fallback logic changed

## [0.9.12] — 2026-05-20 — Fix website picker: switch from OpenRouter to Anthropic API directly

### Fixed
- `app/api/company-enrichment/find-website/route.ts` — replaced OpenRouter call with direct Anthropic API call; `anthropic/claude-haiku` is not a valid OpenRouter model slug (400 on every request, silently falling back to `candidates[0]` for every team); now calls `https://api.anthropic.com/v1/messages` with `claude-haiku-4-5-20251001`; uses `x-api-key` + `anthropic-version` headers per Anthropic spec; removed `OpenRouterResponse` type, added `AnthropicResponse` type matching the messages API response shape

## [0.9.11] — 2026-05-20 — Hard-reject solo agent records before scoring

### Fixed
- `app/api/company-enrichment/find-zillow-url/route.ts` — added `isTeamRecord()` filter applied to all results before scoring; solo agent profiles returned by the secondary search (no `is_team` filter) were reaching the scorer and could be ACCEPTED if their name happened to match; a result now must satisfy at least one of: `is_team === true`, `team_name` field populated, or `business_name` contains "team"/"group"; if all candidates fail, returns `no_results`; logs count of filtered solo records when any are dropped

## [0.9.10] — 2026-05-20 — Harden Zillow matching: `&` timeout fix, associates stop-word, MIN_NAME_SCORE gate

### Fixed
- `app/api/company-enrichment/find-zillow-url/route.ts` — added `'associates'` to `NAME_STOP`; its absence was inflating the Levenshtein name score for any two names sharing the ` associates` suffix (e.g. "Nguyen & Associates" vs "Anna & Associates" scored 45/70 on shared suffix alone, which plus brokerage bonus cleared the 50-point threshold → false positive ACCEPTED)
- Same file — added `sanitizeQuery()`: replaces ` & ` with ` and ` in the query string sent to the Zillow API; the `&` character was causing HTTP 500 statement timeouts server-side; the original name is preserved and used for scoring
- Same file — added `MIN_NAME_SCORE = 40` gate: the name score must independently reach 40/70 before the brokerage bonus (0-30) is considered; prevents brokerage match from rescuing a fundamentally wrong name
- Same file — added three-pass fallback cascade in `searchWithFallback()`: Pass 1 (sanitized name) → Pass 2 (name + brokerage) → Pass 3 (core distinctive token via `coreToken()`); each pass falls through to the next only on 5xx/timeout, never on 0 results
- Same file — `attemptSearch()` now retries up to 3 times with 1s then 3s backoff on 5xx; AbortSignal timeout raised from 10s to 20s per request; returns `timedOut: true` only after all retries exhausted
- Same file — added `'api_timeout'` to `rejection_reason` union type; returned when all passes and all retries are exhausted with no usable results

### Verified
- "Nguyen & Associates" (CO, RE/MAX): name score = 9/70, below MIN_NAME_SCORE 40 → **REJECTED** (was falsely ACCEPTED before fix)
- 5-team regression test batch: all 5/5 correct profile_link matches preserved

## [0.9.9] — 2026-05-20 — Rewrite Zillow URL matching with hard-reject scoring

### Changed
- `app/api/company-enrichment/find-zillow-url/route.ts` — completely rewrote scoring algorithm; old formula (`nameScore×0.7 + apiRelevance×0.3 + locationBonus`) had threshold 0.30 and no hard rejects, producing 18/18 false positives in audit; new formula `nameScore×0.60 + brokerageBonus×0.25 + cityBonus×0.15` with three hard-reject rules: (1) state mismatch → score 0, (2) known brokerage chain mismatch → score 0, (3) name score below 0.35 floor → score 0; thresholds raised to ACCEPT=0.60, HIGH=0.80; `brokerage` field now destructured and used in scoring (was silently dropped before)
- Added `parseLocation()` extracting both city AND state from "Denver CO" / "Austin, TX" format; Strategy B (city+state geofenced) fires first with 8s timeout, Strategy A (no geo, state hard-rejected client-side) is fallback
- Added `BROKERAGE_CHAIN_PATTERNS` mapping 16+ variant names to 10 canonical chain IDs (`kw`, `remax`, `coldwellbanker`, `compass`, `c21`, `bhhs`, `exp`, `sothebys`, `ev`, `howardhanna`); `chainVote()` returns `match`/`mismatch`/`unknown` — only `mismatch` triggers hard-reject (unknown = both sides unrecognized brokerage, treated as neutral)
- Removed `brokerage=` param from all API requests — it causes Zillow API statement timeouts; chain scoring done entirely client-side

### Audit findings (pre-fix)
Batch `080b163d` (10 teams): old algorithm returned results for all 10 where all were wrong (state/brokerage/name mismatches). With new algorithm: 9/10 correctly NONE (all candidates state-rejected, `best=0.00`); 1/10 borderline LOW confidence match (fuzzy name similarity, same state + chain).

### Hard-reject verification
- `best=0.00` in logs → all 10 API candidates were state- or chain- or name-floor-rejected before scoring
- `best=0.50` → candidates passed hard-rejects but fell short of ACCEPT_THRESHOLD (0.60)
- `score=0.66, confidence=low` → accepted match, but LOW confidence flags it for human review

## [0.9.8] — 2026-05-20 — Fix contact count: store name-only agents from Zillow

### Fixed
- `supabase/migrations/20260520010000_fix_ce_insert_agents_bulk.sql` — `ce_insert_agents_bulk` was filtering `WHERE email IS NOT NULL AND email <> ''`, silently dropping all agents extracted from Zillow (which returns names and phones but not email addresses); changed filter to accept any agent with a non-empty `first_name`, `last_name`, OR `email`; added `ON CONFLICT (team_id, COALESCE(lower(first_name),''), COALESCE(lower(last_name),'')) DO NOTHING` for safe re-runs; changed return type from `void` to `int` (actual inserted count)
- `app/api/company-enrichment/run-contacts/route.ts` — `totalAgentsWritten` counter now uses the actual count returned by the RPC instead of `agents.length` (which counted all agents including those that were DO NOTHING'd or filtered)

### Root cause
`extract-team-data` extracts agent names from Zillow pages but not email addresses (Zillow does not expose agent emails). All 9 of 10 agents per team had names only — all were silently dropped by the email-only filter. Only the rare agents who had listed their email in their Zillow profile (1 of 10 per team) were inserted. Result: 2 agents for a 10-team batch. After fix: 70 agents.

### Result
Batch `080b163d` (10 teams): 2 → 70 agents. Email coverage: 4 agents have email addresses (from team websites and agent profiles); remaining 66 have names and are available for cross-referencing.

---

## [0.9.7] — 2026-05-20 — Contact enrichment: replace Python subprocess chain with Edge Function calls

### Fixed
- `app/api/company-enrichment/run-contacts/route.ts` — replaced entire Python subprocess chain (`spawn python3` for discover_team_urls, orchestrate, zillow_team_scraper, merge_agents, clean_contacts) with TypeScript `fetch` calls to the deployed `scrape-urls-combined` and `extract-team-data` Supabase Edge Functions; no Python, no temp files, no XLSX dependency
- Synced `FUNCTION_SECRET` between Railway and Supabase Edge Function secrets via `supabase secrets set` — the mismatch was causing 401 Unauthorized on all Edge Function calls even when the Python scripts ran

### Root causes found
- Python3 not in Railway Node.js container → all `spawn('python3')` calls ENOENT (caught, returned null)
- `orchestrate.py` and `zillow_team_scraper.py` were stubs returning `[]` — even local Python execution would produce 0 contacts
- `FUNCTION_SECRET` digest in Supabase differed from Railway env var — 401 blocked all Edge Function calls

### Architecture (new)
`enrichTeam()` calls `scrapeUrlForAgents()` in parallel for web and zillow URLs. Each call: `scrape-urls-combined` → markdown → `extract-team-data` → `agents_data[]`. `mergeAgents()` deduplicates by email (zillow wins), source tagged `'web'`, `'zillow'`, or `'zillow;web'`.

### Verified (test batch 32caea10, 3 teams)
- Smith Premier Realty: web=1, zillow=4, merged=5 agents
- Pacific Coast Properties: web=0, zillow=7, merged=7 agents
- The Johnson Team: web=0, zillow=1, merged=1 agent
- Total: **13 agents written** to staging.agents, `has_error=false`

---

## [0.9.6] — 2026-05-20 — Port verify-urls to TypeScript, fix export CSV columns, rename button

### Fixed
- `app/api/company-enrichment/verify-urls/route.ts` — replaced `spawn('python3')` subprocess with native TypeScript `fetch` to Oxylabs Universal Scraper; eliminates `spawn python3 ENOENT` on Railway's Node.js container; `web_valid` and `verify_error` now populate correctly
- `app/api/company-enrichment/export/[batch_id]/route.ts` — switched to new `ce_export_batch_teams` RPC; adds missing `zillow_url`/`zillow_valid` columns; column order guaranteed: `MAD_ID, team_name, brokerage, location, website_url, web_valid, zillow_url, zillow_valid, verify_error`
- `app/page.tsx` — renamed "Download CSV" → "Download teams CSV" to distinguish from "Download contacts CSV"

### Added
- `supabase/migrations/20260520000000_ce_export_batch_teams.sql` — new `ce_export_batch_teams(batch_id)` SECURITY DEFINER RPC returning all export columns from `staging.teams`

### Verified (test batch 32caea10)
3/3 websites found, 3/3 Zillow matched, 3/3 `web_valid=true`, `verify_error=null` on all teams

---

## [0.9.5] — 2026-05-19 — Fix contact enrichment for zillow-valid teams

### Fixed
- `app/api/company-enrichment/run-contacts/route.ts` — `python3` not in PATH on Railway was causing `spawn python3 ENOENT` to propagate uncaught through `runZillowScraper`/`runWebScraper`/`runMerge`/`runClean`, setting `hasError=true` and marking zillow-valid teams as failed; wrapped every `runScript` call in try/catch so script failures return `null` (no data) rather than throwing
- Same file — `contact_failed` stage name typo (no trailing `s`) corrected to `contacts_failed` so failing teams are counted in `ce_get_batch_detail` counters and `website_processed`
- Same file — added 0-row short-circuit: after merge, reads merged CSV row count; if 0, returns `[]` without calling `runClean` (avoids `openpyxl` dependency for empty results)
- `supabase/migrations/20260519250000_ce_get_team_stages.sql` — new `ce_get_team_stages(batch_id)` SECURITY DEFINER RPC returning per-team pipeline_stage, zillow_valid, web_valid for diagnostics
- `app/api/company-enrichment/jobs/[batch_id]/team-stages/route.ts` — new GET endpoint exposing `ce_get_team_stages` for direct team stage inspection

### Result
All 10 teams now fully accounted for: `contacts_done=2` (zillow-valid), `contact_skipped=8` (no web or zillow match), `website_processed=10`

---

## [0.9.4] — 2026-05-19 — Live Zillow API lookup with DB fallback

### Added
- `app/api/company-enrichment/find-zillow-url/route.ts` — new internal POST route: accepts `{ team_name, location, brokerage }`; calls live Zillow API (`zillow-zip.up.railway.app/api/agents/search?q=...&is_team=true`) with `ZILLOW_ZIP_API_KEY`; scores results with inline fuzzy matching (tokenOverlapRatio + Levenshtein) against both `team_name` and `business_name` fields; adds 0.15 state-match location bonus; returns `{ zillow_url, matched_name, confidence: 'high'|'low' }` above threshold; returns `{ zillow_url: null, reason: 'network_error' }` on timeout/API failure to signal DB fallback

### Changed
- `app/api/company-enrichment/find-website/route.ts` — Zillow stage now calls `find-zillow-url` internally instead of querying `staging.zillow_profiles` directly; falls back to `ce_find_zillow_url` RPC (DB) only when `reason === 'network_error'` or fetch throws

### Scoring formula
`nameScore * 0.7 + apiRelevance * 0.3 + locationBonus(0.15)` — LOW_THRESHOLD=0.3, HIGH_THRESHOLD=0.6 (high confidence)

---

## [0.9.3] — 2026-05-19 — Harden deletion, fix progress counter accuracy

### Fixed
- `app/api/company-enrichment/jobs/[batch_id]/route.ts` DELETE — added 404 guard: checks `ce_delete_batch` return value (now boolean); returns 404 if batch not found rather than silently succeeding
- `supabase/migrations/20260519240000_ce_delete_batch.sql` — changed return type from `void` to `boolean`; added existence check before any DELETE; all four DELETE statements remain scoped to `WHERE batch_id = p_batch_id`; added DROP before CREATE since return type changed
- `supabase/migrations/20260519210000_ce_count_enriched_teams.sql` — count now restricted to `pipeline_stage IN ('verified','contacts_done')` and `(status='complete' OR status='done')`; previously counted all teams in complete batches regardless of whether they cleared enrichment stages
- `supabase/migrations/20260519220000_ce_get_batch_detail.sql` — `website_found` now `COUNT(*) FILTER (WHERE website_url IS NOT NULL)` instead of pipeline_stage inference; `zillow_found` now `COUNT(*) FILTER (WHERE zillow_url IS NOT NULL)`; these are column-truth counts, not stage-inference counts

---

## [0.9.2] — 2026-05-19 — Pipeline stage tracking + Zillow lookup

### Fixed
- `app/api/company-enrichment/find-website/route.ts` — replaced `ce_update_batch_status` with `ce_update_batch_pipeline` so `current_stage` is updated (required by stage tracker UI); added `ce_update_team_pipeline_stage` calls per team (`website_found`/`website_not_found`); added Zillow lookup stage that queries `staging.zillow_profiles` (30k rows) via new `ce_find_zillow_url` RPC and updates `staging.teams.zillow_url`/`zillow_valid`/`pipeline_stage`; added console.log for every team result
- `app/api/company-enrichment/verify-urls/route.ts` — replaced `ce_update_batch_status` with `ce_update_batch_pipeline`; added `ce_update_team_pipeline_stage('verified')` for ALL teams (including those with no website_url, which previously never advanced past zillow stage); added console.log per team; final status now correctly sets `current_stage='verify_complete'`

### Added
- `supabase/migrations/20260519230000_ce_zillow_lookup.sql` — two new SECURITY DEFINER RPCs: `ce_find_zillow_url(p_team_name text)` (exact team_name/business_name match against staging.zillow_profiles); `ce_update_team_zillow(p_team_id, p_zillow_url, p_zillow_valid)` (updates staging.teams zillow columns)

### Root cause of all teams showing `contact_skipped` with `website_url=null`
- `find_website.py` was failing silently (Oxylabs env var not in subprocess env) — now logs stderr per team
- Neither find-website nor verify-urls ever called `ce_update_team_pipeline_stage` — teams stayed at default stage until run-contacts set them to `contact_skipped`
- `ce_update_batch_status` only updates `status`, not `current_stage` — the stage tracker UI could never show running state

---

## [0.9.1] — 2026-05-19 — Enrichment Q2 progress tracker

### Added
- `app/api/company-enrichment/teams-enriched/route.ts` — GET: returns total teams enriched count via `ce_count_enriched_teams()` RPC (staging.teams JOIN staging.batches WHERE status='complete')
- `supabase/migrations/20260519210000_ce_count_enriched_teams.sql` — `ce_count_enriched_teams()` SECURITY DEFINER function
- `app/page.tsx` — progress bar tracker below "Enrichment Q2" heading: shows `X / 20,000+ teams enriched (X.X%)`, polls every 30s, re-fetches after successful upload; shows "20,000+ target reached 🎉" with full bar when count ≥ 20,000

### Changed
- `app/page.tsx` — renamed section heading from "Team Enrichment" to "Enrichment Q2"

---

## [0.9.0] — 2026-05-19 — Contact enrichment pipeline

### Added
- `app/api/company-enrichment/run-contacts/route.ts` — POST: contact enrichment pipeline per batch; fires automatically from verify-urls fire-and-forget; for each qualified team (web_valid OR zillow_valid) runs SOURCE A (web scraper) and SOURCE B (Zillow scraper) in parallel, then merge + clean; bulk-inserts into staging.agents; marks unqualified teams as `contact_skipped`; cleans up `/tmp/enrich-{batch_id}/` on success
- `app/api/company-enrichment/jobs/[batch_id]/contacts/route.ts` — GET: returns all staging.agents for a batch grouped by team_name
- `app/api/company-enrichment/export-contacts/[batch_id]/route.ts` — GET: CSV download of contacts for a batch
- `scripts/enrichment/web-scraper/discover_team_urls.py` — stub: writes team_priority_urls.json from input CSV (uuid, team_name, url)
- `scripts/enrichment/web-scraper/orchestrate.py` — stub: calls scrape-urls-combined + extract-team-data Edge Functions, outputs agents.csv
- `scripts/enrichment/zillow-scraper/zillow_team_scraper.py` — stub: scrapes Zillow team page via Oxylabs, outputs agents_zillow.csv
- `scripts/enrichment/data-transform/merge_agents.py` — merges --web and --zillow CSVs, deduplicates on email (Zillow wins), outputs agents_merged.csv
- `scripts/enrichment/data-cleaning/clean_contacts.py` — LLM-based cleaning via ANTHROPIC_API_KEY, outputs agents_merged_contact_cleaned.xlsx
- `supabase/migrations/20260519200000_contact_enrichment_setup.sql` — 8 new SECURITY DEFINER RPCs: `ce_get_qualified_teams`, `ce_skip_unqualified_teams`, `ce_update_team_pipeline_stage`, `ce_update_batch_pipeline`, `ce_insert_agents_bulk`, `ce_get_batch_agents`, `ce_get_batches_v2`, `ce_get_batch_info`
- `lib/env.ts` — added `FUNCTION_SECRET` required getter
- `package.json` — added `xlsx` dependency for XLSX parsing

### Changed
- `app/api/company-enrichment/verify-urls/route.ts` — fires run-contacts fire-and-forget after setting status to complete
- `app/api/company-enrichment/jobs/route.ts` — switched from `ce_get_batches` to `ce_get_batches_v2` (returns contacts_count + current_stage)
- `app/api/company-enrichment/jobs/[batch_id]/route.ts` — now returns `contacts_count` and `contact_stage` ('pending'|'running'|'done'|'failed') derived from batch current_stage
- `app/page.tsx` — Company Enrichment section: batches now shown as cards; completed batches with contacts show count + "View contacts" toggle (inline agent table) + "Download contacts" CSV link; `BatchStatusBadge` handles `enriching_contacts` stage

### Schema changes (apply in Supabase dashboard — run migration SQL)
All new functions are CREATE OR REPLACE in the public schema. No new tables needed — uses existing staging.agents.

### Env vars required (add to Railway + .env.local)
- `FUNCTION_SECRET` — secret passed as `x-function-secret` header to scrape-urls-combined and extract-team-data Edge Functions

---

## [0.8.1] — 2026-05-19 — Fix silent error swallowing in Edge Function trigger

### Fixed
- `app/api/enrich/save-and-run/route.ts` — replaced fire-and-forget `.catch()` with `.then(async r => { if (!r.ok) { await updateJob(failed) } }).catch(async err => { await updateJob(failed) })` so HTTP 4xx/5xx from the Edge Function are caught and written to `error_log`; added null guard for `job.raw_csv` — returns 400 and sets `status: 'failed'` if CSV was not stored on upload
- `supabase/functions/generate-enrich-rows/index.ts` — extracted CSV/insert logic into `mainLogic()` and wrapped with `Promise.race` against a 120s timeout; catch block writes `status: 'failed'` before Supabase's 150s hard kill, ensuring the job never stays stuck at `generating`

---

## [0.8.0] — 2026-05-19 — Restore full enrichment pipeline

### Changed
- `app/api/enrich/save-and-run/route.ts` — re-added `status: 'generating'` to the `updateJob` call; re-added fire-and-forget Edge Function trigger (`generate-enrich-rows`); status check now accepts `awaiting_confirmation` or `ready`; returns `{ jobId, status: 'generating' }`; keeps `approval_status`/`approved_at` writes from 0.6.0
- `app/api/enrich/auto-run/route.ts` — restored `updateJob` import, `APP_URL` constant, `await updateJob(jobId, { status: 'both_running' })`, and fire-and-forget fetch to `/api/enrich/pipeline`
- `app/api/enrich/pipeline/route.ts` — restored `prioritizeRows` import, `TypedRow` import, and full QA block (prioritize rows → parallel DB writes of 8 QA fields → filter Excluded/Rejected before branching)
- `supabase/functions/generate-enrich-rows/index.ts` — removed 5-line disabled comment block; restored `appUrl`/`fetch` auto-run trigger at end of success path
- `app/jobs/[jobId]/page.tsx` — restored `allRows`, `showAllRows`, `runningLocally` states; `autoRunFiredRef`; rows fetch `useEffect`; auto-run firing in polling with TERMINAL = `['complete', 'failed']`; `handleSaveAndRun`, `handleRun`, `downloadCSV`; STATE C (ready), STATE D (pipeline running), STATE E (complete with stats/download); GENERATING spinner; `awaiting_confirmation + isConfirmed` → generating fallback; button label changed from "Approve and run enrichment" to "Save and run enrichment"; kept all 0.5.0 additions (dynamic badge, click-to-filter priority pills, `buildTierMap`) and 0.6.0 APPROVED fallback state

### Fixed
- `lib/enrichment/contactPrioritizer.ts` — Fello exclusion now uses word-boundary regex (`/\bfello\b/i`) instead of `.includes('fello')` to avoid false positives on "Fellowstone", "fellow agent", etc.

---

## [0.7.0] — 2026-05-19 — Company enrichment flow

### Added
- `app/api/company-enrichment/start/route.ts` — POST: parses 4-column CSV (MAD_ID, Team Name, Brokerage, Location), creates a staging batch via RPC, inserts team rows via RPC, fires find-website pipeline fire-and-forget
- `app/api/company-enrichment/find-website/route.ts` — POST: fetches teams, calls `scripts/find_website.py` per row (stdin/stdout JSON), writes website back, fires verify-urls fire-and-forget; Zillow stage skipped — `zillow_match` stays null
- `app/api/company-enrichment/verify-urls/route.ts` — POST: fetches teams, calls `scripts/verify_urls.py` per row, writes verified_url back, marks batch complete
- `app/api/company-enrichment/jobs/route.ts` — GET: returns all batches via `ce_get_batches()` RPC
- `app/api/company-enrichment/jobs/[batch_id]/route.ts` — GET: returns teams for a batch via `ce_get_batch_teams()` RPC
- `app/api/company-enrichment/export/[batch_id]/route.ts` — GET: CSV download of all team rows for a batch
- `supabase/migrations/20260519130000_company_enrichment_setup.sql` — creates `staging.batches` + `staging.teams` (IF NOT EXISTS), adds `mad_id` to `staging.teams`, creates seven `public.ce_*` RPC functions as PostgREST workaround for unexposed staging schema
- `scripts/find_website.py` — stub Python script; reads JSON from stdin, writes `{"website": ""}` to stdout; fill in Anthropic + Oxylabs logic
- `scripts/verify_urls.py` — stub Python script; reads JSON from stdin, writes `{"verified_url": ""}` to stdout; fill in Oxylabs logic
- `lib/env.ts` — added `OXYLABS_USERNAME`, `OXYLABS_PASSWORD`, `ANTHROPIC_API_KEY` as required getters
- `app/page.tsx` — Company Enrichment section: CSV upload form + polling batch list with status badges and CSV download link

### Architecture note
`staging` schema is not exposed via PostgREST. Workaround: all reads/writes go through `SECURITY DEFINER` functions in the `public` schema (`ce_*`), called via `supabase.rpc()`. The functions execute with superuser privileges and access staging internally — PostgREST exposure is irrelevant inside a function body.

### Schema changes (apply in Supabase dashboard)
```sql
CREATE SCHEMA IF NOT EXISTS staging;

CREATE TABLE IF NOT EXISTS staging.batches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  uploaded_at timestamptz DEFAULT now() NOT NULL,
  row_count int NOT NULL,
  status text NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS staging.teams (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES staging.batches(id) ON DELETE CASCADE,
  team_name text, brokerage text, location text,
  website text, zillow_match text, verified_url text,
  status text NOT NULL DEFAULT 'pending'
);

ALTER TABLE staging.teams ADD COLUMN IF NOT EXISTS mad_id text;
```
Then run the full migration SQL for the `ce_*` RPC functions.

### Env vars required (add to Railway + .env.local)
- `OXYLABS_USERNAME`
- `OXYLABS_PASSWORD`
- `ANTHROPIC_API_KEY`

---

## [0.6.0] — 2026-05-18 — Pipeline handoff: approval-only flow

### Changed
- `app/api/enrich/save-and-run/route.ts` — removed Edge Function trigger and `status: 'generating'` update; now writes `approval_status: 'approved'` and `approved_at` to the job; status stays `awaiting_confirmation`; returns `{ data: { jobId, approval_status: 'approved' } }`
- `app/api/enrich/auto-run/route.ts` — disabled pipeline fetch and `status: 'both_running'` update; route still validates the job but does nothing further
- `app/api/enrich/pipeline/route.ts` — disabled `prioritizeRows` import and QA DB write block; remaining branch logic is inert (route not triggered by any upstream call)
- `app/jobs/[jobId]/page.tsx` — stripped all post-confirmation UI (STATE C/D/E, generating/ready spinners, auto-run firing, rows download); changed button label from "Save and run enrichment" to "Approve and submit"; added approved state: "List approved. Ready for enrichment pipeline." with job ID; polling stops on `approval_status === 'approved'`
- `supabase/functions/generate-enrich-rows/index.ts` — added top-level disabled comment; commented out auto-run trigger at end of success path
- `lib/supabase/types.ts` — `EnrichJob` extended with `approval_status: 'approved' | null` and `approved_at: string | null`

### Added
- `supabase/migrations/20260518120000_enrich_job_approval.sql` — adds `approval_status text` and `approved_at timestamptz` to `enrich_jobs`

### Schema changes (apply in Supabase dashboard)
```sql
ALTER TABLE enrich_jobs
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
```

### Files intentionally kept but disabled
- `lib/enrichment/contactPrioritizer.ts` — file intact; call disabled in `pipeline/route.ts`
- `supabase/functions/generate-enrich-rows/index.ts` — file intact; trigger removed from `save-and-run`; internal auto-run call disabled
- All run/pipeline/merge-results routes — untouched; not wired to any upstream trigger

---

## [0.5.0] — 2026-05-15 — Pre-enrichment contact prioritization and QA

### Added
- `lib/enrichment/contactPrioritizer.ts` — `prioritizeRows(rows)`: full QA pipeline (Fello exclusion → team name deduplication → RE validation → email/phone classification → company mismatch → priority tier assignment); `summarizeRows(rows)`: lightweight version operating on `GenericFormattedRow[]` for client-side UI previews
- `supabase/migrations/20260515143000_enrich_rows_qa_columns.sql` — 8 new nullable columns on `enrich_rows`: `priority_tier`, `rejected`, `rejection_reason`, `needs_review`, `work_email`, `inferred_website`, `inferred_company`, `team_name_normalized`

### Changed
- `app/api/enrich/pipeline/route.ts` — QA step inserted at start of `runPipeline`: runs `prioritizeRows` on fetched rows, writes 8 QA fields back to DB in parallel, then filters out `Excluded` and `Rejected` rows before passing to Branch 1 and Branch 2
- `lib/supabase/types.ts` — `EnrichRow` extended with 8 new nullable QA fields
- `app/jobs/[jobId]/page.tsx` — contact prioritization summary bar added to STATE B (confirmation page): 5 colored pills (P1/P2/P3/Excluded/Rejected) computed from preview rows via `summarizeRows`; zero counts shown muted

### Schema changes (applied via migration)
```sql
ALTER TABLE enrich_rows
  ADD COLUMN IF NOT EXISTS priority_tier text,
  ADD COLUMN IF NOT EXISTS rejected boolean,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS needs_review boolean,
  ADD COLUMN IF NOT EXISTS work_email boolean,
  ADD COLUMN IF NOT EXISTS inferred_website text,
  ADD COLUMN IF NOT EXISTS inferred_company text,
  ADD COLUMN IF NOT EXISTS team_name_normalized text;
```

---

## [0.4.2] — 2026-05-15 — List type badge on confirmation page

### Added
- `app/jobs/[jobId]/page.tsx` — list type badge in STATE B (confirmation/preview): colored pill above the mapping table showing the detected list type (A–E) with a human-readable label; derived live from `localMapping` so it updates when the user changes a dropdown; renders nothing if mapping is unavailable

---

## [0.4.1] — 2026-05-15 — Input schema detection: list type classification + column mapping report

### Added
- `lib/enrichment/columnDetector.ts` — `classifyListType(mapping)`: pure function, classifies a confirmed `ColumnMapping` into one of five list types (A–E) based on which key fields were detected; no second Gemini call
- `lib/enrichment/columnDetector.ts` — `buildColumnMappingReport(mapping)`: pure function, produces `{ mapped: [{targetField, sourceColumn, confidence}], absent: [targetField] }` from the confirmed mapping
- `lib/supabase/types.ts` — new exported types: `ListType`, `ColumnMappingReportEntry`, `ColumnMappingReport`; `EnrichJob` extended with `list_type` and `column_mapping_report` fields
- `app/api/enrich/save-and-run/route.ts` — at confirm time, computes `list_type` and `column_mapping_report` from the user-confirmed mapping, Zod-validates both, and writes them to `enrich_jobs` alongside the existing `mapping_confirmed` update
- `supabase/migrations/20260515_add_list_type_column_mapping_report.sql` — `ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS list_type text, column_mapping_report jsonb`

### Schema changes (apply in Supabase dashboard)
```sql
ALTER TABLE enrich_jobs
  ADD COLUMN IF NOT EXISTS list_type text,
  ADD COLUMN IF NOT EXISTS column_mapping_report jsonb;
```

---

## [0.4.0] — 2026-05-07 — Parallel team-size pipeline, pipe-syntax field mapping, merged_data expansion

### Added
- `lib/enrichment/cleaners.ts` — `cleanPhone`, `cleanEmail`, `cleanName` extracted as shared utilities
- `app/api/enrich/check-completion/route.ts` — atomic completion check; prevents race condition when both branches finish simultaneously; fires merge-results exactly once
- `app/api/enrich/merge-results/route.ts` — expanded merged output (~70 fields): identity from `formatted_input`, team size from `team_size_data`, full Zillow ZIP fields + mad.agents fields from `contact_data`

### Changed
- `app/api/enrich/team-size-run/route.ts` — rewritten as parallel async: Phase 1 submits all rows simultaneously via `Promise.all`, Phase 2 polls all task IDs in parallel; max ~3.5 min regardless of row count (was serial: ~2 min/row); re-entry guard prevents duplicate runs
- `lib/enrichment/columnMapper.ts` — `resolveField()` added: handles pipe-separated `source_column` values (e.g. `"FirstName|LastName"`) for field concatenation; `mapRowToGeneric` uses cleaners
- `lib/enrichment/columnDetector.ts` — Gemini prompt updated to instruct pipe-syntax for `name` and `location` when only separate first/last or city/state columns exist
- `supabase/functions/generate-enrich-rows/index.ts` — inline `resolveField` + cleaners added; `mapRowToGeneric` matches lib implementation
- `app/jobs/[jobId]/page.tsx` — render order fixes: `both_running` always shows STATE D; `ready+confirmedLocally` spinner now correctly precedes STATE C Run button; STATE B mapping table shows pipe columns as `col1 + col2`
- `app/api/enrich/team-size-process/route.ts` — deleted; replaced by parallel logic in `team-size-run`

### Fixed
- `both_running` status rendered "Generating..." spinner instead of STATE D pipeline progress
- `ready+confirmedLocally` showed Run button instead of "Preparing enrichment..." spinner
- Team-size rows stuck processing for 60+ min due to serial submission and duplicate re-entry
- STATE E (results) not rendering after job completed due to polling stopping before final render

---

## [0.3.0] — 2026-05-04 — Stage 1 real Zillow ZIP API + auto-waterfall pipeline

### Added
- `app/api/enrich/preview/route.ts` — POST: returns first 10 formatted rows from a mapping without writing to DB; powers the live preview table in STATE B
- `app/api/enrich/save-and-run/route.ts` — POST: saves confirmed mapping, fires `generate-enrich-rows` Edge Function fire-and-forget; replaces the old confirm/prepare + confirm/execute split
- `app/api/enrich/auto-run/route.ts` — POST: called by Edge Function after rows are written; sets `stage1_running` and fires `run-enrichment-pipeline`; idempotent if already running
- `supabase/functions/generate-enrich-rows/index.ts` — now calls back to `APP_URL/api/enrich/auto-run` after setting status `ready`, completing the auto-waterfall

### Changed
- `lib/enrichment/stage1.ts` — replaced mock with real Zillow ZIP API: email-first lookup (`/api/agents/by-email?exact=true`), phone fallback (`/api/agents/by-phone`), batched 5 at a time with 500ms delay between batches, 15s per-request timeout via `AbortSignal.timeout`
- `supabase/functions/run-enrichment-pipeline/index.ts` — Stage 1 now uses inline `runStage1Real` (same logic as `lib/enrichment/stage1.ts`, duplicated for Deno isolation); reads `ZILLOW_ZIP_API_KEY` from Edge Function secrets
- `lib/env.ts` — `ZILLOW_ZIP_API_KEY` promoted from `optional` to `required`
- `app/jobs/[jobId]/page.tsx` — complete rewrite: flat component with all state at top level, live mapping preview before DB write, single "Save and run enrichment" button, network error state after 5 consecutive poll failures

### Removed
- `app/api/enrich/confirm/prepare/route.ts` — replaced by `save-and-run`
- `app/api/enrich/confirm/execute/route.ts` — replaced by `save-and-run`

### Env vars
- `ZILLOW_ZIP_API_KEY` — now required; must be set in Railway and in Supabase Edge Function secrets
- `APP_URL` — must be set in Supabase Edge Function secrets (the Railway app URL) for auto-waterfall to work

---

## [0.2.2] — 2026-05-03 — Delete race condition fix

### Fixed
- `app/page.tsx` — polling now pauses while a delete is in flight using `deletingIdsRef` (ref readable inside closures without stale values); prevents the deleted job from re-appearing in the list when the next poll fires before the DB deletion completes
- `app/api/enrich/jobs/[jobId]/route.ts` — DELETE handler wrapped in try/catch with `console.error` logging; success response now returns `{ data: { deleted: true } }` with `Cache-Control: no-store` header

---

## [0.2.1] — 2026-05-02 — Cache fix for job status route

### Fixed
- `app/api/enrich/status/[jobId]/route.ts` — added `Cache-Control: no-store, no-cache, must-revalidate` to response headers; Railway CDN was serving stale job status despite client-side `cache: 'no-store'` on the fetch, causing the job detail page to show STATE B ("awaiting_confirmation") even after the job had already moved to "ready"

---

## [0.2.0] — 2026-05-01 — Three-stage enrichment pipeline (mock)

### Added
- `lib/env.ts` — three optional placeholder vars: `ZILLOW_ZIP_API_KEY`, `STAGE2_DB_URL`, `STAGE3_SCRAPE_URL`
- `lib/enrichment/stage1.ts` — `runStage1Mock` (real-domain + name heuristic), `runStage1Real` (zillow-zip API placeholder), `runStage1` controller (currently mock)
- `lib/enrichment/stage2.ts` — `runStage2Mock` (30% hit rate), `runStage2Real` (throws — DB details TBD), `runStage2` controller
- `lib/enrichment/stage3.ts` — `runStage3Mock` (40% hit rate), `runStage3Real` (throws — endpoint TBD), `runStage3` controller
- `lib/enrichment/pipeline.ts` — `runEnrichmentPipeline`: sequential stage orchestration with per-row DB updates and job status progression
- `supabase/functions/run-enrichment-pipeline/index.ts` — Edge Function: self-contained pipeline runner (inline mocks, no Next.js imports)
- `app/api/enrich/run/[jobId]` — POST: validates job is `ready`, fires Edge Function fire-and-forget, sets status `stage1_running`
- `app/jobs/[jobId]/page.tsx` — STATE D (pipeline progress timeline) and STATE E (results table, enrichment summary, two CSV downloads); STATE C gains "Run Enrichment" button
- `app/page.tsx` — new `StatusBadge` variants: Stage 1/2/3 (blue), Complete (dark green)

### Schema changes (apply manually in Supabase)
```sql
ALTER TABLE enrich_jobs
  ADD COLUMN IF NOT EXISTS stage1_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage2_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage3_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage1_found_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage2_found_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage3_found_count int DEFAULT 0;

ALTER TABLE enrich_rows
  ADD COLUMN IF NOT EXISTS enrichment_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stage_reached int,
  ADD COLUMN IF NOT EXISTS enriched_data jsonb;
```

---

## [0.1.0] — 2026-04-29 — Module 1 initial build

### Added
- `lib/env.ts` — lazy getter-based env validation; throws at access time, not module load
- `lib/supabase/client.ts` — lazy Proxy-based `supabasePublic` and `supabaseAdmin` clients
- `lib/supabase/types.ts` — all domain types: `EnrichJob`, `EnrichRow`, `InsertEnrichRow`, `ColumnMapping`, `TeamSizeInput`, `ZillowInput`
- `lib/supabase/jobs.ts` — `createJob`, `updateJob`, `getJob`, `listJobs`
- `lib/supabase/rows.ts` — `createRows`, `getRowsByJob`, `updateRow`
- `lib/enrichment/columnDetector.ts` — Gemini-based header→field mapping with confidence scoring
- `lib/enrichment/columnMapper.ts` — applies confirmed mapping to produce `TeamSizeInput` + `ZillowInput` per row, with Zillow field renames
- `app/api/enrich/start` — POST: ingest sheet URL, parse CSV, detect columns via Gemini
- `app/api/enrich/confirm` — POST: accept confirmed mapping, generate branch rows, write to DB
- `app/api/enrich/status/[jobId]` — GET: return full job with `sourceHeaders`
- `app/api/enrich/jobs` — GET: list all jobs
- `app/api/enrich/jobs/[jobId]/rows` — GET: return all rows for a job
- `app/page.tsx` — Dashboard with sheet URL form + jobs table, 10s polling
- `app/jobs/[jobId]/page.tsx` — Job detail page: processing / mapping review / ready states
- `vitest.config.ts` + `lib/enrichment/columnMapper.test.ts` — 9 unit tests, all passing
