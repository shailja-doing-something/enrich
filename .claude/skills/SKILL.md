---
name: SKILL
description: Index of all skills available in this project. Claude automatically selects the right skill based on the situation.
---

# Skills Index

Skills are automatic — Claude selects and applies them when it recognizes a matching situation. You do not need to invoke them manually.

---

## Available Skills

### `fix-issue`
**Trigger**: User drops a GitHub issue number or says "fix issue #N"
**What it does**: Fetches the issue, branches, implements the fix, writes a test, and commits
**File**: `.claude/commands/fix-issue.md`

### `pre-review`
**Trigger**: User says "ready to PR", "open a PR", "pre-review", or "review my changes"
**What it does**: Runs tests, lint, build, and self-audit before surfacing the PR for human review
**File**: `.claude/commands/pre-review.md`

### `deploy`
**Trigger**: User says "deploy", "push to production", or "ship this"
**What it does**: Full pre-deploy checklist + Railway push
**File**: `.claude/commands/deploy.md`

---

## Agent Auto-Selection

Claude automatically invokes the right agent based on context:

| Situation | Agent |
|---|---|
| Reviewing a diff or PR | `agents/code-reviewer.md` |
| Something is broken and needs diagnosis | `agents/debugger.md` |
| New feature or bug fix needs tests | `agents/test-writer.md` |
| Code works but is messy | `agents/refactorer.md` |
| Docs are stale or incomplete | `agents/doc-writer.md` |
| Security concern raised or pre-deploy | `agents/security-auditor.md` |

---

## Rules Auto-Selection

Rules are applied based on the file being touched:

| File pattern | Rule applied |
|---|---|
| `app/` components and pages | `rules/frontend.md` |
| `lib/supabase.ts` or any DB query | `rules/database.md` |
| `app/api/` route handlers | `rules/api.md` |
| Any commit or push | `rules/git-push.md` |
