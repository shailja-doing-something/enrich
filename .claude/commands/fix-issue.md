---
name: fix-issue
description: Drop a GitHub issue number and Claude pulls the issue, understands the context, and starts fixing it end-to-end.
---

# Fix Issue Command

Usage: `/fix-issue <issue-number>`

Example: `/fix-issue 42`

## What This Does

1. **Fetches the issue** from GitHub using `gh issue view <number>` — reads title, body, labels, and any linked comments
2. **Classifies the issue**: bug fix, feature request, or chore
3. **Creates a branch** following the naming convention:
   - Bug: `fix/<short-description>`
   - Feature: `feat/<short-description>`
   - Chore: `chore/<short-description>`
4. **Implements the fix** following all rules in `CLAUDE.md`, `rules/`, and the relevant agent if applicable
5. **Writes or updates tests** — every fix needs a test that would have caught the bug
6. **Runs the test suite** — `npm run test` must pass before proceeding
7. **Runs lint** — `npm run lint` must pass
8. **Commits** with message: `[phase-X] Fix: <issue title> (closes #<number>)`
9. **Summarizes** what was changed and why

## Guardrails

- Never fix more than what the issue describes — if the fix requires touching unrelated code, flag it and ask
- If the issue is a Phase 2 concern and Phase 1 is not complete, say so and stop
- If the issue is ambiguous, ask one clarifying question before writing any code
- Security issues: run the `security-auditor` agent after the fix, before committing

## Output After Completion

```
## Issue #<number>: <title>
Branch: <branch-name>
Files changed: <list>
Tests added: <list>
Commit: <message>
```
