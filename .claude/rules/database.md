---
name: database
description: Rules for all Supabase/PostgreSQL interactions in Enrich.
---

# Database Rules

## Client
- Use `@supabase/supabase-js` only — no Prisma, no raw `pg`, no ORM
- Server-side writes use the service role client from `lib/supabase.ts`
- Browser reads use the anon key client — never the service role key in the browser

## Query Patterns
- Always destructure `{ data, error }` from every Supabase call
- Always check `if (error)` before using `data` — never assume success
- No raw SQL strings — Supabase query builder only
- Prefer `.select('specific_columns')` over `.select('*')` to avoid pulling unnecessary data

## Schema Rules
- All tables prefixed `enrich_` in the database — the prefix exists in the DB only, not in app code variable names
- Do not create new tables without the prefix and without being explicitly asked
- `enrich_rows.job_id` is always a valid FK to `enrich_jobs.id` — never insert a row without a confirmed job
- `hs_ticket_url` is the join key — must be present and non-empty on every `enrich_rows` insert

## Status Machine
Respect the status transition order — never skip steps or set status backwards:
```
pending → parsing → awaiting_confirmation → generating → ready → running → complete → failed
```
`failed` is terminal — create a new job rather than resetting a failed one.

## Migrations
- All schema changes via Supabase dashboard SQL editor — no CLI migration files
- Document every schema change in `docs/db-schema.md` before or immediately after applying
- The `moddatetime` extension and `set_updated_at` trigger must exist — verify before any insert to `enrich_jobs`

## What NOT to Do
- No `process.env.SUPABASE_*` inline — through `lib/env.ts` only
- No `.eq('id', userInput)` without validating `userInput` as a UUID first (Zod)
- No bulk deletes without a `job_id` filter — never delete across jobs
