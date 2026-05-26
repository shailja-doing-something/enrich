import { NextRequest } from 'next/server'
import { z } from 'zod'
import { findZillowUrl, type FindZillowResult } from '@/lib/enrichment/zillowMatcher'

const bodySchema = z.object({
  team_name: z.string(),
  location: z.string().default(''),
  brokerage: z.string().default(''),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }
  const { team_name, location, brokerage } = parsed.data

  if (!team_name.trim()) {
    return Response.json({ data: { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'no_state' } })
  }

  let result: FindZillowResult
  try {
    result = await findZillowUrl({ team_name, brokerage, location })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Zillow] fetch error for "${team_name}": ${msg}`)
    return Response.json({ data: { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'api_timeout' } })
  }

  return Response.json({ data: result })
}
