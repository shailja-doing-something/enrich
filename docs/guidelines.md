# Contribution Guidelines

## Scope Rule
Do not add fields, tables, API routes, or logic beyond what is explicitly specified. If something seems useful but wasn't asked for, ask — don't build it.

## Branch Naming
```
feat/<short-description>     # new feature
fix/<short-description>      # bug fix
chore/<short-description>    # tooling, deps, config
docs/<short-description>     # documentation only
phase2/<short-description>   # Phase 2 work only
```

## Commit Standards
- Imperative mood: "Add confirm route" not "Added..."
- One logical change per commit
- Tag phase when relevant: `[phase-1]` or `[phase-2]`
- Example: `[phase-1] Add Gemini header mapping with confidence scores`

## PR Standards
- Title mirrors branch purpose
- Description: what changed + why + how to test manually
- No PR mixes Phase 1 and Phase 2 work
- Every new env var introduced in a PR must be added to `CLAUDE.local.md` template

## Testing Requirements
- Framework: `vitest`
- API routes: `supertest` integration tests
- Test files colocated with source: `lib/enrichment/columnMapper.test.ts`
- Minimum coverage per unit:
  1. Happy path
  2. Missing required field returns expected error/empty
  3. Gemini mapper: mock the API call — never hit real Gemini in tests
- Do NOT mock Supabase in integration tests — use a test job ID against the real dev DB

## Security Considerations
- **Never send data rows to Gemini** — headers only. This is a hard rule; PII lives in data rows.
- `SUPABASE_SERVICE_ROLE_KEY` is never exposed to the browser — server-side only
- `NEXT_PUBLIC_` prefix only for Supabase URL and anon key — nothing else
- Phase 2 credentials (`HUBSPOT_API_KEY`, `N8N_WEBHOOK_SECRET`, `TEAM_SIZE_SERVICE_URL`) must not appear in any Phase 1 code path, even as dead imports
- No raw sheet data written to server logs — `error_log` in DB is fine, `console.log(row)` is not
- Zod-validate all API route inputs before they touch Supabase or Gemini

## Code Style
- TypeScript strict mode — no `any`, no `!` non-null assertions without a comment explaining why
- Supabase queries always destructure `{ data, error }` and check `error` before using `data`
- All env vars through `lib/env.ts` — never `process.env.X` inline in routes or lib files
