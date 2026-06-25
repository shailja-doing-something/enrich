# Enrich

Internal GTM tool for Fello.ai. A user uploads a CSV of real estate contacts; the tool looks up each contact in the Zillow agent profiles database (Stage 1), then enriches matched rows with full agent detail (Stage 2, stub). No LLM, no HubSpot integration, no column mapping — the CSV schema is fixed.

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
│   │   ├── stage2/[jobId]/route.ts  # POST — triggers Stage 2 (stub)
│   │   └── export/[jobId]/route.ts  # GET  — CSV download (?stage=1 or ?stage=2)
│   ├── page.tsx                     # Single-page dashboard (upload → stage1 → stage2)
│   └── globals.css
├── lib/
│   ├── env.ts                       # Lazy env var getters
│   ├── supabase/
│   │   ├── client.ts                # supabaseAdmin (main project)
│   │   ├── zillowClient.ts          # zillowDb (Zillow project)
│   │   └── types.ts                 # EnrichJob, EnrichRow TypeScript types
│   ├── csv/
│   │   ├── parse.ts                 # parseCSV — CSV text → ParsedRow[]
│   │   └── export.ts                # buildStage1CSV, buildStage2CSV
│   └── pipeline/
│       ├── stage1.ts                # runStage1 — Zillow lookup per row
│       └── stage2.ts                # runStage2 — agent detail stub
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

Any other column is preserved verbatim in `extra_fields` (JSONB) and carried through to both CSV exports. Rows with no Name AND no Email are dropped.

## Two Supabase Projects

| Client          | Project                                        | Used for                        |
|-----------------|------------------------------------------------|---------------------------------|
| `supabaseAdmin` | Main Enrich project (`NEXT_PUBLIC_SUPABASE_URL`) | `enrich_jobs`, `enrich_rows`   |
| `zillowDb`      | `ofpbfajzbuoxrmphthyr.supabase.co`             | `public.zillow_agent_profiles` |

Both clients are lazy-initialized via `Proxy` — safe for `next build` even without env vars.

## Stage 1 Lookup Priority (per row)
Tries in this order, returns on first hit:

1. **Email** — `.ilike('email', row.email)` on `zillow_agent_profiles` — `match_type: 'email'`
2. **Phone** — strips non-digits, takes last 10 digits, `.eq('phone_cell', normalized)` — `match_type: 'phone'`
3. **Name + state fuzzy** — requires `row.location` to end with `, XX` (2-letter state); `.ilike('full_name', '%name%').eq('address_state', state)` — `match_type: 'name_fuzzy'`
4. **No match** — `match_type: 'no_match'`, `zillow_url: null`

Stage 1 processes rows in batches of 10 (`Promise.all`). On completion it counts matched rows and updates `enrich_jobs.stage1_matched`.

## Stage 2 (stub)
Stage 2 is a placeholder. It marks every `zillow_url IS NOT NULL` row as processed (`stage2_completed_at = now()`) and logs "Stage 2 table TBD". Replace `enrichRow()` in `lib/pipeline/stage2.ts` when the agent detail table is available.

## Pipeline Architecture
```
POST /api/enrich/upload
  ├── parseCSV(text)          → ParsedRow[]
  ├── INSERT enrich_jobs      → job_id
  ├── INSERT enrich_rows      → one row per ParsedRow
  └── runStage1(jobId) [fire-and-forget]
        └── lookupZillowProfile(row) × N (batches of 10)
              Writes: zillow_url, match_type, stage1_completed_at

GET /api/enrich/status/[jobId]   → { job: EnrichJob, rows: EnrichRow[] }
  (polled every 2s by UI)

POST /api/enrich/stage2/[jobId]  → fires runStage2 [fire-and-forget]

GET /api/enrich/export/[jobId]?stage=1|2  → CSV download
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
