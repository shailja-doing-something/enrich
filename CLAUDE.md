# Enrich

Internal GTM AI tool for Fello.ai that automates HubSpot ticket enrichment. A user uploads a CSV, Gemini maps source columns to known target fields, the user confirms the mapping, and Enrich generates a single generic formatted sheet stored in Supabase. Three sequential enrichment stages then run against each row.

## Tech Stack
- **Framework**: Next.js 14 App Router, TypeScript (strict)
- **Database**: Supabase (PostgreSQL) — shared project with BillFlow, tables prefixed `enrich_`
- **DB client**: `@supabase/supabase-js` — no ORM, no Prisma
- **LLM**: Gemini API (`gemini-2.5-flash`) via `@google/generative-ai` — header mapping only
- **CSV**: `papaparse`
- **Infra**: Railway + Supabase Edge Functions

## Directory Structure
```
enrich/
├── app/
│   ├── api/enrich/         # Route handlers (start, confirm, status, jobs)
│   └── page.tsx            # Dashboard
├── lib/
│   ├── supabase/           # client, types, jobs, rows
│   ├── env.ts              # Lazy env var getters
│   └── enrichment/
│       ├── columnDetector.ts  # Gemini call + confidence scoring
│       └── columnMapper.ts    # Confirmed mapping → GenericFormattedRow
├── supabase/functions/
│   └── generate-enrich-rows/ # Edge Function: CSV → formatted_input rows
├── docs/
└── CLAUDE.md
```

## Pipeline Architecture
```
Upload CSV → Gemini maps headers → User confirms → Edge Function generates rows
     ↓
enrich_rows.formatted_input (GenericFormattedRow, 8 fields)
     ↓
Stage 1: first endpoint (TBD)       → stage1_found_count, stage1_completed_at
Stage 2: DB table lookup (TBD)      → stage2_found_count, stage2_completed_at
Stage 3: scrape endpoint (TBD)      → stage3_found_count, stage3_completed_at
     ↓
HubSpot write → hubspot_written_at
```

## GenericFormattedRow (single template, always 8 fields)
`name, email, phone, team_name, brokerage, website, location, hs_ticket_url`

- `hs_ticket_url` is never detected by Gemini — always stamped from user input
- Missing source columns → empty string (template shape is always complete)

## Key Commands
```bash
npm run dev           # Start local dev server (port 3000)
npm run build         # Production build
npm run lint          # ESLint
npm run test          # vitest run
supabase functions deploy generate-enrich-rows
```

## Coding Conventions
- All env vars through `lib/env.ts` only — never inline `process.env`
- API routes return `{ data: T }` on success, `{ error: string }` on failure
- Zod validation on every route handler input — no exceptions
- No `any` — use `unknown` + narrowing
- Supabase errors: always check `{ data, error }` destructure; never assume success
- No raw SQL — use Supabase query builder only

## Architecture Decisions
- **Gemini on headers only**: 7 strings sent to LLM, never data rows — zero PII exposure
- **hs_ticket_url excluded from mapping**: collected on upload form, stamped server-side
- **Single pipeline**: no branches — one formatted_input per row feeds all three stages
- **Edge Function for row generation**: avoids Railway timeout on large CSVs
- **Shared Supabase project**: same dashboard as BillFlow, `enrich_` prefix isolates tables

## External Integrations
| Service | Stage | Connection |
|---|---|---|
| Gemini API | Upload | `@google/generative-ai`, key via `GEMINI_API_KEY` |
| Supabase | All | `@supabase/supabase-js`, service role key for server writes |
| Stage 1 endpoint | Stage 1 | TBD |
| Stage 2 DB lookup | Stage 2 | TBD |
| Stage 3 scraper | Stage 3 | TBD |
| HubSpot API | Final | REST via `HUBSPOT_API_KEY` |

## What NOT To Do
- Do not send data rows to Gemini — headers only, always
- Do not add tables, fields, or logic beyond what is specified — ask first
- Do not use Prisma or any ORM — Supabase client only
- Do not hardcode column names — all mappings are Gemini-generated and DB-stored

## Detailed Docs
- @docs/architecture.md — system design, component map, data flow
- @docs/db-schema.md — all tables, fields, relationships, indexes
- @docs/guidelines.md — contribution rules, PR standards, security
- @docs/lessons-learned.md — gotchas, decisions, what worked/didn't
- @docs/release-notes.md — changelog
