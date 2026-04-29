---
name: pre-review
description: Self-review checklist to run before requesting a code review or opening a PR. Catches obvious issues before a reviewer sees them.
---

# Pre-Review Command

Usage: `/pre-review`

Run this before opening a PR or asking for a human review. It runs all automated checks and then does a quick self-audit.

## Automated Checks

```bash
npm run test       # all tests pass
npm run lint       # zero lint errors
npm run build      # zero TypeScript errors
```

If any of these fail, stop — fix them before continuing.

## Self-Audit (Claude runs these manually)

### Scope Check
- [ ] The changes match only what was asked for — no scope creep
- [ ] No new files created that weren't needed
- [ ] No speculative features or abstractions added

### Security Spot-Check
- [ ] No data rows passed to Gemini
- [ ] No env vars inline — all through `lib/env.ts`
- [ ] All new API route inputs validated with Zod
- [ ] No `NEXT_PUBLIC_` on sensitive keys

### Convention Check
- [ ] No `any` types introduced
- [ ] All Supabase calls check `{ data, error }`
- [ ] API routes return `{ data }` or `{ error }` — nothing else
- [ ] New env vars documented in `CLAUDE.local.md`

### Test Check
- [ ] New logic has at least a happy path test
- [ ] No Gemini API called in tests (mocked)

## Output

```
## Pre-Review Summary
Automated: PASS | FAIL
Self-audit: PASS | ISSUES FOUND

Issues (if any):
- [file:line] description

Ready for review: YES | NO
```

Only mark "Ready for review: YES" if both automated checks and self-audit pass.
