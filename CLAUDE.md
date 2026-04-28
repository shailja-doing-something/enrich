# Enrich

Internal GTM AI tool for Fello.ai that automates HubSpot ticket enrichment. A user pastes a Google Sheet URL into the UI; Enrich fetches the sheet, sends only the header row to Gemini to intelligently map source columns to known target fields, shows the mapping for confirmation, then generates two perfectly templated input sheets — one for the team size branch, one for the Zillow branch — stored in Supabase. Phase 2 (separate module) runs both enrichers in parallel, validates Zillow results, merges outputs, and writes back to HubSpot.

## Tech Stack
- **Framework**: Next.js 14 App Router, TypeScript (strict)
- **Database**: Supabase (PostgreSQL) — shared project with BillFlow, tables prefixed `enrich_`
- **DB client**: `@supabase/supabase-js` — no ORM, no Prisma
- **LLM**: Gemini API (`gemini-2.0-flash`) via `@google/generative-ai` — header mapping only
- **CSV**: `papaparse`
- **Fuzzy match**: `fastest-levenshtein` (Phase 2 only)
- **Infra**: Railway

## Directory Structure
```
enrich/
├── app/
│   ├── api/enrichment/     # Route handlers (start, status, confirm)
│   └── page.tsx            # UI entry point (Phase 1 only)
├── lib/
│   ├── supabase.ts         # Supabase client (server + browser)
│   ├── gemini.ts           # Gemini client
│   └── enrichment/
│       ├── columnMapper.ts # Header → branch template transform
│       ├── geminiMapper.ts # Gemini call + confidence scoring
│       └── zillowValidator.ts  # Phase 2: 5-rule validation
├── docs/                   # Detailed documentation
├── .claude/                # Agent/command/hook/rule config
└── CLAUDE.md               # This file
```

## Key Commands
```bash
npm run dev           # Start local dev server (port 3000)
npm run build         # Production build
npm run lint          # ESLint
npm run test          # vitest run
npx supabase status   # Check local Supabase (if running locally)
```

## Coding Conventions
- All env vars through `lib/env.ts` only — never inline `process.env`
- API routes return `{ data: T }` on success, `{ error: string }` on failure
- Zod validation on every route handler input — no exceptions
- No `any` — use `unknown` + narrowing
- Supabase errors: always check `{ data, error }` destructure; never assume success
- No raw SQL — use Supabase query builder only

## Architecture Decisions
- **Gemini on headers only**: 8-20 strings sent to LLM, never data rows — zero PII exposure, fast, cheap
- **Confidence scoring**: `high/medium/low` per field; medium + low surfaced to user before proceeding
- **Shared Supabase project**: same dashboard as BillFlow, `enrich_` prefix isolates tables — no extra credentials
- **No ORM**: Supabase client is the query layer — Prisma adds no value here
- **Two-phase split**: Phase 1 (parse + generate) fully testable with no external service dependencies
- **HS_Ticket URL as join key**: unique identifier across all tables and both enrichment branches

## External Integrations
| Service | Phase | Connection |
|---|---|---|
| Google Sheets | 1 | Public CSV export URL — no auth needed |
| Gemini API | 1 | `@google/generative-ai`, key via `GEMINI_API_KEY` |
| Supabase | 1+2 | `@supabase/supabase-js`, service role key for server writes |
| HubSpot API | 2 | REST via `HUBSPOT_API_KEY` |
| n8n Zillow webhook | 2 | POST to `N8N_ZILLOW_WEBHOOK_URL` with `N8N_WEBHOOK_SECRET` |
| FastAPI team size | 2 | POST to `TEAM_SIZE_SERVICE_URL` |

## What NOT To Do
- Do not send data rows to Gemini — headers only, always
- Do not add tables, fields, or logic beyond what is specified — ask first
- Do not use Prisma or any ORM — Supabase client only
- Do not hardcode column names — all mappings are Gemini-generated and DB-stored
- Do not use `enrich_` prefix in code — it belongs in the DB only; use plain names in app logic
- Do not share Phase 2 service credentials in Phase 1 code paths

## Detailed Docs
- @docs/architecture.md — system design, component map, data flow diagrams
- @docs/db-schema.md — all tables, fields, relationships, indexes
- @docs/guidelines.md — contribution rules, PR standards, security
- @docs/lessons-learned.md — gotchas, decisions, what worked/didn't
- @docs/release-notes.md — changelog
