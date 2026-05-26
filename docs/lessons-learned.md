# Lessons Learned

## Gotchas

### staging.zillow_agent_profiles has no trigram index — filter by is_team first, score app-side
The table has 781k rows with only BTREE indexes on `full_name`, `team_name`, `is_team`, `email`, etc. — no pg_trgm GIN index. Fuzzy name queries with `LIKE '%name%'` would do sequential scans. The practical query strategy: filter `is_team = true AND address_state = $state` using the `is_team` index (reduces to ~45k team records), then filter by state (no state index, ~900/state), return up to 2000, score entirely in TypeScript using the same `scoreAndPick` logic used for API results. This is fast enough and consistent — one scorer for both sources.

### Zillow `team_name` is only 6.3% populated — `full_name` is the reliable name field
In `staging.zillow_agent_profiles`, `team_name` is only set on ~49k of 781k rows. `full_name` (99.9% populated) is the agent's public display name and frequently contains the actual team name. Scoring must use BOTH: `Math.max(calcNameScore(input, r.team_name ?? ''), calcNameScore(input, r.full_name ?? ''))`. Relying on `team_name` alone misses the majority of team profiles.

### Zillow scraping returns names only — email-gating the INSERT silently drops all agents
The `extract-team-data` Edge Function extracts agent names from Zillow team pages but NOT emails (Zillow does not expose agent email addresses). If the bulk-insert RPC filters `WHERE email IS NOT NULL`, every Zillow-sourced agent is silently dropped. The `totalAgentsWritten` counter still increments (it uses `agents.length`, not the actual DB insert count), so the route response logs a non-zero count while the DB has 0. Fix: filter by `name IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL` (any identifying field), add `ON CONFLICT DO NOTHING`, and return the actual inserted count from the RPC.

### `ce_insert_agents_bulk` return type change requires DROP before CREATE OR REPLACE
PostgreSQL does not allow `CREATE OR REPLACE FUNCTION` to change the return type of an existing function. Changing from `void` to `int` requires `DROP FUNCTION IF EXISTS ce_insert_agents_bulk(jsonb)` first. Always include the DROP in the migration when changing return types.

### Pipeline re-enable: keep `approval_status` writes when restoring `status: 'generating'`
When the pipeline was stripped in 0.6.0, `approval_status`/`approved_at` writes were added and `status: 'generating'` was removed. On restore, both sets of writes must coexist in the same `updateJob` call — the approval columns are kept for auditability and the APPROVED fallback UI. Do not remove approval writes just because the pipeline is running again.

### staging.agents has `designation`, not `job_title`
The actual column for job title in staging.agents is `designation`, not `job_title`. The spec used "Job Title" as the display name for the cleaned output column, which maps to `designation` in the DB. Always check `supabase gen types typescript --schema staging` before assuming column names on staging tables.

### staging.agents has no `team_name` column — derive via JOIN
There is no `team_name` column on staging.agents. The team name is stored on staging.teams and linked via the `team_id` FK. The `ce_get_batch_agents` RPC does a JOIN to return team_name. Never try to write team_name directly to staging.agents.

### `supabase gen types typescript --project-id` works without Docker
When Docker is unavailable, `supabase gen types typescript --project-id <ref> --schema <schema>` still works (uses the Supabase API, not local Docker). This is the fastest way to inspect schema on unexposed staging tables when information_schema is inaccessible via PostgREST.

### Fire-and-forget `.catch()` silently swallows HTTP errors
`fetch(...).catch(err => ...)` only catches network-level failures (DNS, refused connection). An HTTP 4xx/5xx response from the Edge Function resolves the promise successfully — `.catch()` never fires. The job sits stuck at `generating` with no error in the DB. Fix: chain `.then(async r => { if (!r.ok) { ... await updateJob(failed) } }).catch(async err => { ... await updateJob(failed) })` so both error classes are handled.

### Edge Function timeout leaves job stuck unless `Promise.race` guards the logic
Supabase kills Edge Functions at 150s. If the function logic runs past that, the internal `catch` block never executes — the job stays at `generating` forever. Fix: extract logic into `mainLogic()` and race against a 120s `setTimeout`-based rejection. The race's `catch` always runs before the external kill, writing `status: 'failed'` to the DB.

### Fello exclusion uses word-boundary regex, not `.includes()`
`/\bfello\b/i` prevents "Fellowstone", "Fellow Agent", etc. from being excluded as Fello employees. The domain check (`domain.includes('fello')`) is intentionally kept broad since email domains are more controlled.

### Accessing an unexposed Supabase schema via RPC
PostgREST only serves schemas listed in the exposed schemas setting. Calling `.schema('staging')` from the JS client returns `PGRST106` if `staging` is not in that list. Workaround: create `SECURITY DEFINER` functions in the `public` schema that access the staging tables internally. Call them via `supabase.rpc('function_name', ...)`. The function runs with definer privileges on the Postgres server — PostgREST exposure is irrelevant inside the function body. Prefix all such functions (e.g. `ce_*`) to avoid collisions with application functions.



### `lib/env.ts` must use lazy getters, not eager evaluation
`next build` imports all route modules during "Collecting page data" and "Generating static pages". If `env` is a plain object with values assigned at module load (`const env = { KEY: required('KEY') }`), the build throws even when env vars are present at runtime. Fix: use JS getter syntax (`get KEY() { return required('KEY') }`) so validation is deferred to first access inside a request handler.

### Supabase clients must be lazily initialized for the same reason
`createClient(url, key)` is called at module evaluation time if placed at the top level of `client.ts`. During `next build`, importing any route that transitively imports `client.ts` triggers `createClient`, which triggers the env getter, which throws. Fix: wrap both clients in a `Proxy` that creates the real client on first property access (lazy singleton pattern).

### GET API routes need `export const dynamic = 'force-dynamic'`
Next.js 14 App Router attempts to statically prerender GET routes at build time unless told otherwise. Any GET route that hits Supabase must export `dynamic = 'force-dynamic'` to opt out.

### `next.config.ts` is not supported in Next.js 14
Next.js 14 (pre-15) does not support `next.config.ts`. Must use `next.config.js` or `next.config.mjs`.

### Supabase migration history repair workflow
When `supabase db push` fails with "Remote migration versions not found in local migrations directory", the remote history table has a version the CLI cannot match to a local file. Fix: `supabase migration repair --status reverted <version>` to remove the stray remote entry, then re-push. The `IF NOT EXISTS` guards in migration SQL make re-applying idempotent.

### Spreading a Set requires `Array.from()` under the project's TypeScript target
`[...new Set(...)]` triggers "Type 'Set' can only be iterated through when using '--downlevelIteration'". Use `Array.from(new Set(...))` instead — same result, no tsconfig change needed.

### Do not import server-side lib files into client components
`lib/enrichment/columnDetector.ts` imports `@google/generative-ai`. Importing it into a `"use client"` component pulls the Gemini SDK into the browser bundle. For UI-only use of pure logic that lives in a server-side file, inline the logic directly in the component file rather than importing it.

### `ce_update_batch_status` vs `ce_update_batch_pipeline` — always use the latter for pipeline routes
`ce_update_batch_status` only updates `status`, not `current_stage`. The stage tracker UI reads `current_stage` (returned as `stage` from `ce_get_batch_detail`). Using `ce_update_batch_status` in pipeline routes means the stage tracker never shows running state. Always use `ce_update_batch_pipeline(batch_id, stage, status)` in any route that advances the pipeline.

### Pipeline routes must call `ce_update_team_pipeline_stage` per team — it doesn't happen automatically
Teams in `staging.teams` start with `pipeline_stage=null`. Nothing advances it automatically. Every route that processes a team must explicitly call `ce_update_team_pipeline_stage` after processing. If skipped, all teams stay at `null` until `ce_skip_unqualified_teams` sets them to `contact_skipped`, masking all earlier pipeline stages.

### Teams without website_url must still advance through verify stage
Skipping teams with `null website_url` in verify-urls means those teams never get `pipeline_stage='verified'`. The `qa_processed` counter never reaches `total_teams`, so the contact enrichment approval gate never opens. Fix: set `web_valid=false` and `pipeline_stage='verified'` even for teams with no URL.

### Classification and report are computed at confirm time, not at detect time
`classifyListType` and `buildColumnMappingReport` run in `save-and-run` (confirm route), not in `detectColumnMapping`. This is intentional: the user may adjust the mapping before confirming, so classification must reflect the final confirmed mapping, not Gemini's initial output.

### Zillow scoring above 1.0 signals old code is deployed — `_relevance` is not normalized
The Zillow search API returns a `_relevance` field that is NOT bounded to [0,1] — values like 1.2 are common. If the scoring formula uses `_relevance` as a multiplier or addend directly, results can exceed 1.0. A score >1.0 in logs means the old formula is running. The new formula uses only `nameScore * 0.60 + brokerageBonus + cityBonus` (max = 1.00); scores >1.0 are a deploy check signal.

### Hard-reject all three cases before scoring, or the formula compensates for the reject
When state matches, brokerage matches, AND city matches, a very weak name similarity (nameScore ≈ 0.43) can push a result over the ACCEPT_THRESHOLD (0.60 formula: 0.43×0.60 + 0.25 + 0.15 = 0.658). This is the right trade-off — if you know the team is in the same city and same chain, a fuzzy-enough name is plausible. The hard-reject floor (MIN_NAME_SCORE=0.35) prevents completely unrelated names from gaming the bonuses. Names below 0.35 are rejected regardless of chain/city match.

### `brokerage=` param causes Zillow API statement timeouts — score client-side instead
Sending `brokerage=` to the Zillow `/api/agents/search` endpoint consistently causes backend timeouts (>8s, sometimes up to 30s). Never send it. Receive all results matching the team name, then score brokerage chain client-side via BROKERAGE_CHAIN_PATTERNS normalization.

### `&` in team name causes Zillow API HTTP 500 statement timeout — sanitize before sending
A bare `&` in the `q=` query param (e.g. "Nguyen & Associates") triggers a slow server-side Postgres query path that consistently times out. Fix: `sanitizeQuery()` replaces ` & ` with ` and ` before building `URLSearchParams`. The original team name is always used for scoring — only the outgoing query string is sanitized.

### Zillow `full_name` is the public profile display name — score it alongside `team_name`
Zillow result objects have three name fields: `team_name` (often the lead agent's personal name, e.g. "Jennifer Anderson"), `business_name` (the brokerage), and `full_name` (the public profile display name, e.g. "The Jen Anderson Team - Long Realty"). The actual team name lives in `full_name` for many profiles. Scoring only `team_name` and `business_name` produces ns=0 for any team whose display name is in `full_name` only. Fix: add `full_name` as a third argument to the `Math.max(...)` call in the `ns` computation.

### OpenRouter model IDs are versioned — `anthropic/claude-haiku` is not valid
OpenRouter requires versioned model slugs (e.g. `anthropic/claude-3-haiku`, `anthropic/claude-3-5-haiku`). The bare `anthropic/claude-haiku` returns HTTP 400 "not a valid model ID". The error is caught and the function falls back to `candidates[0]` silently, so website picking appears to work but is always just taking the first Oxylabs result. Fix: remove OpenRouter entirely and call the Anthropic API directly (`https://api.anthropic.com/v1/messages`) with the `ANTHROPIC_API_KEY` already in env — cleaner, no intermediate service, correct response shape.

### Secondary Zillow search (no is_team filter) returns solo agents — filter before scoring
When the primary `is_team=true` search returns 0 results, a secondary search without the filter fires as fallback. Solo agent profiles can appear in these results and, if their name matches the team name string, can score above the acceptance threshold. Fix: `isTeamRecord()` filters all results before scoring, requiring at least one of: `is_team === true`, a non-empty `team_name` field, or `business_name` containing "team"/"group" (word-boundary match). Apply this filter to results from BOTH primary and secondary searches — the primary should be clean, but the secondary is where solo agents slip in.

### Missing stop-words inflate Levenshtein score on shared generic suffixes
If a common suffix token (e.g. `associates`) is not in `NAME_STOP`, two unrelated names can score artificially high by sharing only that suffix. Example: "Nguyen & Associates" and "Anna & Associates" both normalize to `"X associates"`, giving a Levenshtein distance of 6 over max length 17 → name score 45/70. Adding `'associates'` to `NAME_STOP` reduces both to their distinctive root ("nguyen" vs "anna"), which have distance 6/6 → score 0. Rule: any token that commonly appears as a team/business name suffix and carries no identity information belongs in NAME_STOP.

## Decisions

### Proxy pattern for Supabase clients
Kept the named `supabasePublic` / `supabaseAdmin` exports (as specified) while making initialization lazy by wrapping with `new Proxy({}, { get(_, prop) { ... } })`. Alternative of exporting factory functions would have required changing all call sites in `jobs.ts` and `rows.ts`.

### `source_headers` stored on `enrich_jobs`
The confirm-state UI needs to show all original sheet headers in the dropdown (not just the ones Gemini mapped). Storing them on the job at parse time avoids re-fetching and re-parsing the CSV just to populate a `<select>`.

## What Worked

- Vitest runs fast and needs no special setup for pure TypeScript utility functions
- Separating column detection (Gemini call) from column mapping (pure transform) makes the mapper fully unit-testable without any mocks
- Inline-copying mock logic into the Edge Function (rather than importing from `lib/`) keeps the Deno runtime isolated and avoids module-resolution issues between Next.js and Deno
- Fire-and-forget pattern for the Edge Function trigger (`fetch().catch(...)` without `await`) keeps the API route response fast while the pipeline runs independently

## What Didn't

- Eager env validation at module load breaks `next build` — must be lazy

## Decisions

### Edge Function contains its own copy of pipeline logic
Supabase Edge Functions run in Deno and cannot import from Next.js `lib/` modules (different module resolution, no `@/` alias). The pipeline logic and mock stages are duplicated inline in the Edge Function. When swapping to real implementations, both `lib/enrichment/stage*.ts` (for any server-side use) and the Edge Function must be updated.

### Stage controllers default to mock, swappable with a one-line change
Each stage file exports a `runStageN` controller that calls the mock. Swapping to real requires changing one line per file. The real functions are present but not wired up, making the swap explicit and auditable.

### Polling continues through complete state
The job detail page polls every 2s even after `status === 'complete'`, re-fetching rows every 3 polls (~6s). This catches any late DB writes without requiring a manual refresh. Stop condition is `failed` only.

### React state is stale inside polling closures — use refs
`useEffect` captures state values at the time the effect runs. A polling `setInterval` closure will always see the initial value of any `useState` variable. Fix: maintain a parallel `useRef` that is updated alongside every `setState` call; read the ref (not the state) inside the closure. This pattern was needed for `confirmedLocally`, `localMapping`, and `autoRunFired` in the job detail page.

### `mapping_confirmed` in DB is not a reliable UI gate
After the user confirms a mapping, the DB is updated with `mapping_confirmed: true`. On the next poll the client receives this flag, which caused STATE B (mapping review) to be skipped. The fix is to track confirmation purely client-side with `confirmedLocally` state — never re-derive STATE B from `job.mapping_confirmed`.

### Auto-waterfall requires `APP_URL` set in Edge Function secrets
The `generate-enrich-rows` Edge Function fires a callback to `APP_URL/api/enrich/auto-run` after writing rows. This env var must be set in Supabase dashboard → Edge Functions → Secrets (not just Railway). Without it the pipeline never starts and the job sits at `ready` forever.

### Zillow ZIP API: email lookup must use `exact=true`
Without `exact=true`, fuzzy matching returns unrelated agents. Pass `exact=true&limit=1` for email lookups. Phone lookups don't need it — the normalized 10-digit string is already exact enough.

### Railway CDN caches GET responses aggressively
`Cache-Control` on the response alone isn't enough — Railway's CDN ignores it. Fix requires: `export const revalidate = 0` + `export const fetchCache = 'force-no-store'` on the route module, full cache headers on the response, AND a `?t=${Date.now()}` cache-buster on every client fetch.

### Stopping polling on a field other than `status`
The job detail page polling loop checked `status` to determine terminal state. When the terminal signal lives in a different column (`approval_status === 'approved'`), add the check inside the poll callback and `return` early — do not add `'approved'` to the TERMINAL status list because it is not a `status` value.

### Unused imports after disabling calls leave TypeScript errors
When commenting out a fetch call that was the only consumer of an `import`, comment out the import too. In `auto-run/route.ts`, `updateJob` was imported only for the disabled pipeline trigger — leaving it imported would produce an unused-variable error under strict mode.

### Pipeline status must not advance when the pipeline is not running
The `save-and-run` route previously set `status: 'generating'` to signal row generation had started. After removing the Edge Function trigger, do not set that status — the job should stay at `awaiting_confirmation`. Only set the two new approval columns. Setting `generating` without the Edge Function running would leave the job stuck with no way to progress.
