# Release Notes

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
