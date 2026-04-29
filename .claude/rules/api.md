---
name: api
description: Rules for all API route handlers in app/api/.
---

# API Rules

## Response Shape
Every route handler returns exactly one of:
- **Success**: `Response.json({ data: T }, { status: 200 | 201 })`
- **Failure**: `Response.json({ error: string }, { status: 400 | 404 | 500 })`

No other shape. No nested `{ success: true, result: ... }`. No bare arrays.

## Input Validation
- Every POST/PUT handler validates the request body with a Zod schema before any other logic
- Zod parse failure → 400 with `{ error: z.ZodError.message }`
- Path params (e.g. `jobId`) validated as UUID via Zod before any Supabase query

```ts
// Pattern: parse first, then proceed
const parsed = schema.safeParse(await request.json())
if (!parsed.success) {
  return Response.json({ error: parsed.error.message }, { status: 400 })
}
```

## Error Handling
- Catch errors at the route boundary — never let an unhandled exception escape a route handler
- Write detailed error to `enrich_jobs.error_log` (DB), return generic message to client
- Log the error server-side but never log raw row data: `console.error(error.message)` not `console.error(row)`

## Route Conventions
- Route files: `app/api/enrichment/<action>/route.ts`
- Export only the HTTP methods the route supports: `export async function POST(...)` — no unused exports
- Use `NextRequest` for typed request access

## What NOT to Do
- No direct Gemini or Supabase calls without going through `lib/` modules
- No Phase 2 route handlers in Phase 1 (no placeholders, no empty handlers)
- No `console.log(requestBody)` or `console.log(row)` — PII risk
- Never return a 200 with an error message in the body — use the correct HTTP status
