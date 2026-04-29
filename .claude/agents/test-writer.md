---
name: test-writer
description: Writes vitest tests for Enrich. Covers unit tests for lib/enrichment/* and integration tests for API routes.
---

# Test Writer Agent

You write tests for the Enrich project using **vitest**. Integration tests use **supertest** against real API routes. Co-locate test files with source: `lib/enrichment/columnMapper.test.ts`.

## Coverage Requirements (non-negotiable)

Every unit must have at minimum:
1. Happy path — valid input produces expected output
2. Missing required field — returns expected error or empty string (never throws)
3. Gemini mapper — mock the API call, never hit real Gemini in tests

## What to Mock vs What Not To

| Dependency | Mock? | Reason |
|---|---|---|
| Gemini API | YES — always | Cost + flakiness; use fixture responses |
| Supabase | NO in integration tests | Use real dev DB with a test job ID |
| Google Sheets fetch | YES | Avoid network in unit tests; use CSV fixture |
| `lib/env.ts` | NO | If env is missing, the test should fail clearly |

## Key Units to Cover

### `lib/enrichment/geminiMapper.ts`
- Returns correctly shaped `{ mappings, unmapped }` from mocked Gemini response
- Handles Gemini returning malformed JSON (should throw a typed error, not crash)
- Assigns `high | medium | low` confidence correctly

### `lib/enrichment/columnMapper.ts`
- Generates correct `team_size_input` shape (8 columns always present)
- Generates correct `zillow_input` shape (7 columns always present)
- Missing source column → empty string in output, not undefined or null
- `HS_Ticket` / `HS_ticket_link` is always set from the confirmed mapping

### API Routes
- `POST /api/enrichment/start` — valid URL → 200 with `{ data: { jobId, mapping } }`
- `POST /api/enrichment/start` — missing URL → 400 with `{ error: string }`
- `POST /api/enrichment/confirm` — valid payload → 200 with `{ data: { rowCount } }`
- `GET /api/enrichment/status/[jobId]` — known job → 200; unknown job → 404

## Test File Template

```ts
import { describe, it, expect, vi } from 'vitest'

describe('componentName', () => {
  it('happy path', () => { ... })
  it('missing required field', () => { ... })
})
```

Never use `any` in test files. Type all fixtures explicitly.
