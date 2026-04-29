---
name: deploy
description: Runs all pre-deploy checks and pushes to Railway. Blocks on any failure.
---

# Deploy Command

Usage: `/deploy`

## Pre-Deploy Checklist (all must pass — no exceptions)

1. **Tests** — `npm run test` — zero failures
2. **Lint** — `npm run lint` — zero errors
3. **Build** — `npm run build` — must compile cleanly (no TypeScript errors)
4. **Env var audit** — confirm all required vars are set in Railway dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`
5. **DB migrations** — confirm any new `enrich_` tables or columns are already applied in Supabase (not auto-migrated on deploy)
6. **No Phase 2 credentials in Phase 1 code** — grep for `HUBSPOT`, `N8N`, `TEAM_SIZE` in `app/` and `lib/` — must return zero results

## Deploy Steps

1. Merge to `main` (or confirm current branch is what should deploy)
2. Run `git push railway main` (or trigger Railway deploy via dashboard)
3. Monitor Railway build log — watch for runtime errors in first 60 seconds
4. Verify `/api/enrichment/status/health` (or equivalent) returns 200

## If Deploy Fails

- Check Railway build logs for the exact error
- Do NOT force-push or patch in production — fix locally, re-run this checklist, redeploy
- Update `docs/lessons-learned.md` with any new deploy gotcha discovered

## Post-Deploy

- Update `docs/release-notes.md` with what shipped and the date
