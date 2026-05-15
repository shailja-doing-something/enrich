# Database Schema

Enrich shares a Supabase project with BillFlow. All tables are prefixed `enrich_` to isolate them. Do not create tables without the prefix.

---

## `enrich_jobs`

One row per enrichment run. Tracks the full lifecycle from sheet ingestion to HubSpot write.

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | Primary key |
| `created_at` | `timestamptz` | `now()` | Auto-set on insert |
| `updated_at` | `timestamptz` | `now()` | Updated via trigger |
| `sheet_url` | `text` | — | Original Google Sheet URL pasted by user |
| `raw_row_count` | `int4` | `null` | Set after CSV parse completes |
| `parsed_at` | `timestamptz` | `null` | Set when rows are written to `enrich_rows` |
| `column_mapping` | `jsonb` | `null` | Gemini output: array of `{ sourceColumn, targetField, confidence }` + `unmapped[]` |
| `mapping_confirmed` | `bool` | `false` | Set true when user confirms mapping |
| `list_type` | `text` | `null` | Set at confirm time: `A` (name+email), `B` (name only), `C` (email only), `D` (team_name, no name/email), `E` (other) |
| `column_mapping_report` | `jsonb` | `null` | Set at confirm time: `{ mapped: [{targetField, sourceColumn, confidence}], absent: [targetField] }` |
| `status` | `text` | `'pending'` | See status values below |
| `team_size_status` | `text` | `'idle'` | `idle \| running \| complete \| failed` |
| `zillow_status` | `text` | `'idle'` | `idle \| running \| complete \| failed` |
| `team_size_completed_at` | `timestamptz` | `null` | Phase 2 |
| `zillow_completed_at` | `timestamptz` | `null` | Phase 2 |
| `merged_at` | `timestamptz` | `null` | Phase 2 |
| `hubspot_written_at` | `timestamptz` | `null` | Phase 2 |
| `error_log` | `text` | `null` | Last error message for this job |

**Status values (in order):**
`pending → parsing → mapping → awaiting_confirmation → generating → ready → running → complete → failed`

---

## `enrich_rows`

One row per source sheet row per job. Stores all inputs, outputs, and validation results.

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | Primary key |
| `job_id` | `uuid` | — | FK → `enrich_jobs.id` |
| `row_index` | `int4` | — | Zero-based position in source sheet |
| `hs_ticket_url` | `text` | — | Join key — unique per row within a job |
| `raw_data` | `jsonb` | — | Original source row as-is |
| `team_size_input` | `jsonb` | `null` | Templated input for team size branch |
| `zillow_input` | `jsonb` | `null` | Templated input for Zillow branch |
| `team_size_data` | `jsonb` | `null` | Phase 2: response from team size service |
| `zillow_data` | `jsonb` | `null` | Phase 2: response from Zillow/n8n |
| `phone_match` | `bool` | `null` | Phase 2: Zillow validation rule 1 |
| `email_match` | `bool` | `null` | Phase 2: Zillow validation rule 2 |
| `email_domain_match` | `bool` | `null` | Phase 2: Zillow validation rule 3 |
| `company_match` | `bool` | `null` | Phase 2: Zillow validation rule 4 |
| `zillow_verdict` | `text` | `null` | Phase 2: `yes \| no` |
| `zillow_score` | `int4` | `null` | Phase 2: count of passing rules (0–4) |
| `merged_data` | `jsonb` | `null` | Phase 2: final merged output |

---

## Relationships

```
enrich_jobs (1) ──── (many) enrich_rows
                             FK: enrich_rows.job_id → enrich_jobs.id
```

---

## Indexes

| Table | Index | Reason |
|---|---|---|
| `enrich_rows` | `job_id` | Primary lookup — all row queries are scoped to a job |
| `enrich_rows` | `hs_ticket_url` | Phase 2 join key — used for HubSpot write and merge |
| `enrich_jobs` | `status` | Polling and admin queries filter by status |

---

## Migration Notes

- Tables are created directly in Supabase dashboard (SQL editor) or via migration file
- No Prisma — no `prisma migrate` commands
- `updated_at` trigger must be created manually in Supabase (not automatic):
  ```sql
  create trigger set_updated_at
  before update on enrich_jobs
  for each row execute function moddatetime('updated_at');
  ```
- The `moddatetime` extension must be enabled: `create extension if not exists moddatetime;`
- Always use `enrich_` prefix — BillFlow tables live in the same schema
