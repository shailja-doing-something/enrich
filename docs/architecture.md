# Architecture

## System Overview

Enrich is a two-phase pipeline. Phase 1 (this codebase) handles ingestion, AI-assisted column mapping, and templated sheet generation. Phase 2 (separate module) connects external enrichers and writes back to HubSpot.

```
Phase 1 — Parse & Generate
─────────────────────────────────────────────────────────────
User pastes sheet URL
        │
        ▼
POST /api/enrichment/start
  - Create enrich_jobs row (status: parsing)
  - Fetch sheet as CSV (public export URL)
  - Extract header row only
  - Call Gemini: map headers → known target fields + confidence
  - Store mapping in enrich_jobs.column_mapping (status: awaiting_confirmation)
  - Return { jobId, mapping, unmappedColumns }
        │
        ▼
UI: Show mapping to user
  - High confidence fields shown collapsed
  - Medium/low confidence shown for review
  - User confirms or adjusts
        │
        ▼
POST /api/enrichment/confirm
  - Mark enrich_jobs.mapping_confirmed = true (status: generating)
  - Parse all data rows using confirmed mapping
  - For each row: generate team_size_input + zillow_input
  - Bulk insert into enrich_rows
  - Update enrich_jobs (status: ready, raw_row_count, parsed_at)
  - Return { rowCount }

Phase 2 — Enrich & Merge (separate module)
─────────────────────────────────────────────────────────────
  [Documented in Phase 2 repo]
```

---

## Component Responsibilities

| Component | File | Responsibility |
|---|---|---|
| Start route | `app/api/enrichment/start/route.ts` | Accept sheet URL, create job, call Gemini, return mapping |
| Confirm route | `app/api/enrichment/confirm/route.ts` | Accept confirmed mapping, parse rows, generate branch inputs |
| Status route | `app/api/enrichment/status/[jobId]/route.ts` | Return job status fields |
| Gemini mapper | `lib/enrichment/geminiMapper.ts` | Send headers to Gemini, return field map + confidence scores |
| Column mapper | `lib/enrichment/columnMapper.ts` | Apply confirmed mapping → team_size_input + zillow_input per row |
| Supabase client | `lib/supabase.ts` | Server and browser client instances |
| Gemini client | `lib/gemini.ts` | Initialized `@google/generative-ai` instance |
| Env | `lib/env.ts` | Single source of truth for environment variables |
| Zillow validator | `lib/enrichment/zillowValidator.ts` | Phase 2: 5-rule match + verdict (not used in Phase 1) |

---

## Branch Templates

**Team size input** (8 columns, always present):
`list_name, list_email, list_phone, list_team_name, list_brokerage, list_website, list_location, HS_Ticket`

**Zillow input** (7 columns, always present):
`list_name, list_company, list_location, brokerage_name, list_mobile, list_email, HS_ticket_link`

- `list_website` is dropped from Zillow branch
- Missing columns are written as empty string — both templates always have the same shape
- `HS_Ticket` / `HS_ticket_link` is the join key across all rows

---

## Gemini Mapping Contract

Enrich sends Gemini the raw header array and a prompt that includes the two target field lists. Gemini returns:

```json
{
  "mappings": [
    { "sourceColumn": "Agent Email", "targetField": "list_email", "confidence": "high" },
    { "sourceColumn": "Team", "targetField": "list_team_name", "confidence": "medium" },
    { "sourceColumn": "HubSpot Link", "targetField": "HS_Ticket", "confidence": "low" }
  ],
  "unmapped": ["Notes", "Created Date"]
}
```

- Unmatched source columns are returned in `unmapped` and silently dropped
- `confidence` values: `high | medium | low`
- Stored verbatim in `enrich_jobs.column_mapping`

---

## Key Design Patterns

- **Stateless confirm endpoint**: same input always produces same rows — idempotent if re-run
- **Template-first generation**: branch inputs are written even when source value is missing (empty string) — enrichers always receive known shape
- **Job-scoped state**: all processing state lives in `enrich_jobs.status` — UI polls `/status/[jobId]` to reflect current phase
