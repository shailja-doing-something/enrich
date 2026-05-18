# Architecture

## System Overview

Enrich is a two-phase pipeline. Phase 1 (this codebase) handles ingestion, AI-assisted column mapping, and templated sheet generation. Phase 2 (separate module) connects external enrichers and writes back to HubSpot.

```
Phase 1 — Ingest & Approve (current)
─────────────────────────────────────────────────────────────
User uploads CSV + HubSpot ticket URL
        │
        ▼
POST /api/enrich/start
  - Create enrich_jobs row (status: parsing)
  - Parse CSV via papaparse
  - Extract header row only
  - Call Gemini: map headers → known target fields + confidence
  - Store mapping in enrich_jobs.column_mapping (status: awaiting_confirmation)
  - Return { jobId, mapping, sourceHeaders }
        │
        ▼
UI: Show mapping to user (STATE B)
  - List type badge (A–E)
  - Column mapping table with override dropdowns
  - Blank field warnings + ignored columns
  - Live preview table (first 10 rows via /api/enrich/preview)
  - QA summary bar (P1/P2/P3/Excluded/Rejected via summarizeRows)
  - User reviews and clicks "Approve and submit"
        │
        ▼
POST /api/enrich/save-and-run
  - Validate confirmed mapping
  - Compute list_type + column_mapping_report
  - Write to enrich_jobs: mapping_confirmed=true, list_type, column_mapping_report,
    approval_status='approved', approved_at=now()
  - Status stays: awaiting_confirmation
  - Return { data: { jobId, approval_status: 'approved' } }
        │
        ▼
UI: Show approved state
  - "List approved. Ready for enrichment pipeline."
  - Job ID visible
  - Polling stops — no further steps triggered from this codebase

Phase 2 — Enrich & Merge (pending new pipeline integration)
─────────────────────────────────────────────────────────────
  The enrichment pipeline (row generation → Branch 1 team-size → Branch 2 contact
  → merge → HubSpot write) has been decoupled from Phase 1. It will be triggered
  externally after approval. Route files and logic are kept in place but not wired
  to any upstream trigger. See release-notes.md [0.6.0] for details.
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
