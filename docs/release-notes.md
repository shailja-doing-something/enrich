# Release Notes

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
