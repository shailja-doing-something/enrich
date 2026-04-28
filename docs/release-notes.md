# Release Notes

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
