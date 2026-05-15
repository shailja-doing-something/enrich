# Release Notes

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
