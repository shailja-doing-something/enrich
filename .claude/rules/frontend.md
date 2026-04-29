---
name: frontend
description: Rules for the Enrich UI — Next.js 14 App Router, TypeScript strict, no component libraries.
---

# Frontend Rules

## Framework
- **Next.js 14 App Router only** — no Pages Router patterns, no `getServerSideProps`, no `getStaticProps`
- Server Components by default — add `"use client"` only when interactivity requires it (event handlers, browser APIs, hooks)
- Route handlers live in `app/api/` — never fetch from client to an external API directly; always proxy through a route handler

## TypeScript
- Strict mode — no `any`, no `!` non-null assertions without a comment
- Props always typed with an explicit interface or type alias — never inline object type on a component signature
- `unknown` + narrowing over casting

## State & Data Fetching
- Polling `/api/enrichment/status/[jobId]` from the client: use `setInterval` with cleanup in `useEffect`, not a library
- No global state library (Redux, Zustand, etc.) — local component state is enough for Phase 1
- Optimistic UI only when the operation is truly reversible — confirmation mapping is not

## Styling
- No CSS-in-JS — plain CSS modules or Tailwind only
- No component library (MUI, Chakra, etc.) — keep the bundle lean

## What NOT to Do
- Do not call Gemini or Supabase directly from the browser — always through route handlers
- Do not pass `SUPABASE_SERVICE_ROLE_KEY` to any client component
- Do not add new pages, routes, or UI components beyond what is explicitly specified
