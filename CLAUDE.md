# Enrich

Internal GTM tool for Fello.ai. A user uploads a CSV of real estate contacts; the tool looks up each contact in the Zillow agent profiles database and returns the matched Zillow profile URL + scraped profile data. No LLM, no HubSpot integration, no column mapping — the CSV schema is fixed. Single-stage pipeline (Stage 1 only).

## Tech Stack
- **Framework**: Next.js 14 App Router, TypeScript (strict)
- **Primary DB**: Supabase — `enrich_jobs` + `enrich_rows` tables (main Enrich project)
- **Zillow DB**: Separate Supabase project (`ofpbfajzbuoxrmphthyr.supabase.co`) — `public.zillow_agent_profiles`
- **DB client**: `@supabase/supabase-js` — no ORM, no Prisma
- **CSV**: `papaparse`
- **Infra**: Railway

## Directory Structure
```
enrich/
├── app/
│   ├── api/enrich/
│   │   ├── upload/route.ts          # POST — CSV upload, creates job, fires Stage 1
│   │   ├── status/[jobId]/route.ts  # GET  — job + rows polling endpoint
│   │   └── export/[jobId]/route.ts  # GET  — CSV download
│   ├── page.tsx                     # Single-page dashboard (upload → results)
│   └── globals.css
├── lib/
│   ├── env.ts                       # Lazy env var getters
│   ├── supabase/
│   │   ├── client.ts                # supabaseAdmin (main project)
│   │   ├── zillowClient.ts          # zillowDb (Zillow project)
│   │   └── types.ts                 # EnrichJob, EnrichRow TypeScript types
│   ├── csv/
│   │   ├── parse.ts                 # parseCSV — CSV text → ParsedRow[]
│   │   └── export.ts                # buildStage1CSV
│   └── pipeline/
│       └── stage1.ts                # runStage1 — Zillow lookup per row
├── supabase/
│   └── migrations/
│       └── 001_enrich_overhaul.sql  # Apply in Supabase dashboard
└── CLAUDE.md
```

## Fixed CSV Schema
Input columns (case-insensitive, whitespace-trimmed):

| Column   | Maps to          |
|----------|------------------|
| Name     | `name`           |
| Email    | `email`          |
| Phone    | `phone`          |
| Location | `location`       |
| Website  | `website`        |

Any other column is preserved verbatim in `extra_fields` (JSONB) and carried through to the CSV export. Rows with no Name AND no Email are dropped.

## Two Supabase Projects

| Client          | Project                                        | Used for                        |
|-----------------|------------------------------------------------|---------------------------------|
| `supabaseAdmin` | Main Enrich project (`NEXT_PUBLIC_SUPABASE_URL`) | `enrich_jobs`, `enrich_rows`   |
| `zillowDb`      | `ofpbfajzbuoxrmphthyr.supabase.co`             | `public.zillow_agent_profiles` |

Both clients are lazy-initialized via `Proxy` — safe for `next build` even without env vars.

## Lookup Priority (per row)
Tries in this order via `lookupZillowProfile()` in `lib/pipeline/stage1.ts`, returns on first hit:

1. **email_company** — email + company domain match via `find_zillow_by_email_company` RPC
2. **email** — email-only match via `find_zillow_by_email` RPC
3. **name_team** — name match against `team_name` via `find_zillow_by_name_team` RPC
4. **website** — website URL match via `find_zillow_by_website` RPC (normalises protocol/www/trailing slash)
5. **phone_name** — phone + name fuzzy match via `find_zillow_by_phone_name` RPC (checks all 3 phone columns)
6. **name_company_state** — name + company + state match via `find_zillow_by_name_company_state` RPC
7. **name_fuzzy** — name + state fuzzy match via `find_zillow_by_name_fuzzy` RPC
8. **no_match** — `match_type: 'no_match'`, `zillow_url: null`

All RPCs are `SECURITY DEFINER` in `public` schema, accessing `staging.zillow_agent_profiles`. Returns `to_jsonb(z.*)` so full profile is stored in `enrich_rows.zillow_profile`.

Stage 1 processes rows in batches of 10 (`Promise.all`). On completion it counts matched rows and updates `enrich_jobs.stage1_matched`.

## Pipeline Architecture
```
POST /api/enrich/upload
  ├── parseCSV(text)          → ParsedRow[]
  ├── INSERT enrich_jobs      → job_id
  ├── INSERT enrich_rows      → one row per ParsedRow
  └── fires /api/enrich/run/[jobId] [fire-and-forget]
        └── runStage1(jobId)
              └── lookupZillowProfile(row) × N (batches of 10)
                    Writes: zillow_url, match_type, zillow_profile, stage1_completed_at

GET /api/enrich/status/[jobId]   → { job: EnrichJob, rows: EnrichRow[] }
  (polled every 2s by UI)

GET /api/enrich/export/[jobId]   → CSV download (Stage 1 results)
```

## Key Commands
```bash
npm run dev    # Start local dev server (port 3000)
npm run build  # Production build (must exit 0)
npm run lint   # ESLint
npm run test   # vitest (tests need to be written)
```

## Env Vars (add to .env.local)
```
NEXT_PUBLIC_SUPABASE_URL=   # Main Enrich project URL
SUPABASE_SERVICE_ROLE_KEY=  # Main Enrich project service role key
ZILLOW_SUPABASE_URL=https://ofpbfajzbuoxrmphthyr.supabase.co
ZILLOW_SUPABASE_KEY=        # Zillow project service role key
```

## Coding Conventions
- All env vars through `lib/env.ts` only — never inline `process.env`
- API routes return `{ data: T }` on success, `{ error: string }` on failure
- Zod validation on every route handler input — no exceptions
- No `any` — use `unknown` + narrowing
- Supabase errors: always check `{ data, error }` destructure; never assume success
- No raw SQL — Supabase query builder only
- Both Supabase clients use lazy Proxy pattern — never call `createClient()` at module top level

## What NOT To Do
- Do not add Gemini, HubSpot, or column mapping logic — the CSV schema is fixed
- Do not add tables, fields, or routes beyond what is specified — ask first
- Do not use Prisma or any ORM — Supabase client only
- Do not call `process.env` directly — always go through `lib/env.ts`
- Do not eagerly initialize Supabase clients — use the Proxy pattern in `client.ts`

## Detailed Docs
- @docs/architecture.md — system design (may be stale post-overhaul)
- @docs/db-schema.md — table definitions (see migration for current schema)
- @docs/guidelines.md — contribution rules, PR standards
- @docs/lessons-learned.md — gotchas and decisions
- @docs/release-notes.md — changelog
