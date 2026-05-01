# Lessons Learned

## Gotchas

### `lib/env.ts` must use lazy getters, not eager evaluation
`next build` imports all route modules during "Collecting page data" and "Generating static pages". If `env` is a plain object with values assigned at module load (`const env = { KEY: required('KEY') }`), the build throws even when env vars are present at runtime. Fix: use JS getter syntax (`get KEY() { return required('KEY') }`) so validation is deferred to first access inside a request handler.

### Supabase clients must be lazily initialized for the same reason
`createClient(url, key)` is called at module evaluation time if placed at the top level of `client.ts`. During `next build`, importing any route that transitively imports `client.ts` triggers `createClient`, which triggers the env getter, which throws. Fix: wrap both clients in a `Proxy` that creates the real client on first property access (lazy singleton pattern).

### GET API routes need `export const dynamic = 'force-dynamic'`
Next.js 14 App Router attempts to statically prerender GET routes at build time unless told otherwise. Any GET route that hits Supabase must export `dynamic = 'force-dynamic'` to opt out.

### `next.config.ts` is not supported in Next.js 14
Next.js 14 (pre-15) does not support `next.config.ts`. Must use `next.config.js` or `next.config.mjs`.

## Decisions

### Proxy pattern for Supabase clients
Kept the named `supabasePublic` / `supabaseAdmin` exports (as specified) while making initialization lazy by wrapping with `new Proxy({}, { get(_, prop) { ... } })`. Alternative of exporting factory functions would have required changing all call sites in `jobs.ts` and `rows.ts`.

### `source_headers` stored on `enrich_jobs`
The confirm-state UI needs to show all original sheet headers in the dropdown (not just the ones Gemini mapped). Storing them on the job at parse time avoids re-fetching and re-parsing the CSV just to populate a `<select>`.

## What Worked

- Vitest runs fast and needs no special setup for pure TypeScript utility functions
- Separating column detection (Gemini call) from column mapping (pure transform) makes the mapper fully unit-testable without any mocks
- Inline-copying mock logic into the Edge Function (rather than importing from `lib/`) keeps the Deno runtime isolated and avoids module-resolution issues between Next.js and Deno
- Fire-and-forget pattern for the Edge Function trigger (`fetch().catch(...)` without `await`) keeps the API route response fast while the pipeline runs independently

## What Didn't

- Eager env validation at module load breaks `next build` — must be lazy

## Decisions

### Edge Function contains its own copy of pipeline logic
Supabase Edge Functions run in Deno and cannot import from Next.js `lib/` modules (different module resolution, no `@/` alias). The pipeline logic and mock stages are duplicated inline in the Edge Function. When swapping to real implementations, both `lib/enrichment/stage*.ts` (for any server-side use) and the Edge Function must be updated.

### Stage controllers default to mock, swappable with a one-line change
Each stage file exports a `runStageN` controller that calls the mock. Swapping to real requires changing one line per file. The real functions are present but not wired up, making the swap explicit and auditable.

### Polling continues through complete state
The job detail page polls every 2s even after `status === 'complete'`, re-fetching rows every 3 polls (~6s). This catches any late DB writes without requiring a manual refresh. Stop condition is `failed` only.
