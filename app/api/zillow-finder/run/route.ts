import { NextRequest } from 'next/server'
import { z } from 'zod'
import { findZillowUrl } from '@/lib/enrichment/zillowMatcher'

// No Supabase imports — this route is stateless and writes nothing to any database.

const rowSchema = z.object({
  mad_id: z.string(),
  team_name: z.string(),
  brokerage: z.string().default(''),
  location: z.string().default(''),
})

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(50),
})

type InputRow = z.infer<typeof rowSchema>

type ResultRow = InputRow & {
  zillow_url: string | null
  match_score: number
  matched_name: string | null
  source: string
  rejection_reason?: string
}

async function processRow(row: InputRow): Promise<ResultRow> {
  try {
    const match = await findZillowUrl({
      team_name: row.team_name,
      brokerage: row.brokerage,
      location: row.location,
    })
    return { ...row, ...match }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[zillow-finder] error for "${row.team_name}": ${msg}`)
    return { ...row, zillow_url: null, match_score: 0, matched_name: null, source: 'none', rejection_reason: 'api_timeout' }
  }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { rows } = parsed.data

  // Process the batch concurrently — caller sends at most 5 rows per request to
  // cap Zillow API concurrency without needing internal chunking here.
  const settled = await Promise.allSettled(rows.map(processRow))

  const results: ResultRow[] = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { ...rows[i], zillow_url: null, match_score: 0, matched_name: null, source: 'none', rejection_reason: 'api_timeout' }
  )

  return Response.json({ data: { results } })
}
