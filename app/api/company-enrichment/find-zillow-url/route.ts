import { NextRequest } from 'next/server'
import { z } from 'zod'
import { distance } from 'fastest-levenshtein'
import { env } from '@/lib/env'

const bodySchema = z.object({
  team_name: z.string(),
  location: z.string().default(''),
  brokerage: z.string().default(''),
})

// Stripped before token comparison to isolate core identity tokens
const MATCH_STOP_WORDS = new Set([
  'realty', 'real', 'estate', 'properties', 'property', 'group', 'team',
  'homes', 'home', 'associates', 'llc', 'inc', 'ltd', 'corp', 'co', 'the',
  'of', 'at', 'on', 'and', 'in', 'by', 'brokered',
])

const LOW_THRESHOLD = 0.3
const HIGH_THRESHOLD = 0.6

type ZillowResult = {
  profile_link: string
  team_name?: string | null
  business_name?: string | null
  full_name?: string | null
  address_city?: string | null
  address_state?: string | null
  is_team?: boolean
  _relevance?: number
}

type ZillowApiResponse = {
  total: number
  page: number
  limit: number
  total_pages: number
  results: ZillowResult[]
}

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0 && !MATCH_STOP_WORDS.has(t))
    .join(' ')
    .trim()
}

function tokenOverlapRatio(a: string, b: string): number {
  const tokA = a.split(/\s+/).filter(Boolean)
  const tokB = b.split(/\s+/).filter(Boolean)
  if (tokA.length === 0 || tokB.length === 0) return 0
  const shorter = tokA.length <= tokB.length ? tokA : tokB
  const longer = tokA.length <= tokB.length ? tokB : tokA
  return shorter.filter(t => longer.includes(t)).length / shorter.length
}

function fuzzySimScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  return maxLen === 0 ? 1 : 1 - distance(a, b) / maxLen
}

function nameMatchScore(query: string, candidate: string): number {
  const nq = normalizeForMatch(query)
  const nc = normalizeForMatch(candidate)
  if (!nq || !nc) return 0
  const overlap = tokenOverlapRatio(nq, nc)
  const fuzzy = fuzzySimScore(nq, nc)
  return Math.max(overlap, fuzzy)
}

// Extracts 2-char state code from location string like "Pittsburgh PA" or "PA" or "Pittsburgh, PA"
function extractState(location: string): string {
  const tokens = location.trim().replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  const last = tokens.at(-1) ?? ''
  return last.length === 2 ? last.toUpperCase() : ''
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
  const { team_name, location } = parsed.data

  if (!team_name.trim()) {
    return Response.json({ data: { zillow_url: null, reason: 'empty_team_name' } })
  }

  const inputState = extractState(location)

  const url = new URL('https://zillow-zip.up.railway.app/api/agents/search')
  url.searchParams.set('q', team_name)
  url.searchParams.set('is_team', 'true')
  url.searchParams.set('full_profile', 'true')
  url.searchParams.set('limit', '5')

  let apiData: ZillowApiResponse
  try {
    const resp = await fetch(url.toString(), {
      headers: { 'x-api-key': env.ZILLOW_ZIP_API_KEY },
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      console.error(`[find-zillow-url] API error ${resp.status}: ${text}`)
      return Response.json({ data: { zillow_url: null, reason: 'network_error' } })
    }
    apiData = (await resp.json()) as ZillowApiResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[find-zillow-url] fetch failed for "${team_name}": ${msg}`)
    return Response.json({ data: { zillow_url: null, reason: 'network_error' } })
  }

  const results = apiData.results ?? []
  if (results.length === 0) {
    return Response.json({ data: { zillow_url: null, reason: 'no_results' } })
  }

  // Score each result and pick the best
  let bestScore = -1
  let bestResult: ZillowResult | null = null

  for (const r of results) {
    const candidateTeamName = r.team_name ?? ''
    const candidateBusiness = r.business_name ?? ''
    const apiRelevance = typeof r._relevance === 'number' ? r._relevance : 0

    const teamScore = nameMatchScore(team_name, candidateTeamName)
    const bizScore = nameMatchScore(team_name, candidateBusiness)
    const nameScore = Math.max(teamScore, bizScore)

    let locationBonus = 0
    if (inputState && r.address_state) {
      if (r.address_state.toUpperCase() === inputState) locationBonus = 0.15
    }

    const combined = nameScore * 0.7 + apiRelevance * 0.3 + locationBonus
    if (combined > bestScore) {
      bestScore = combined
      bestResult = r
    }
  }

  if (!bestResult || bestScore < LOW_THRESHOLD) {
    console.log(`[find-zillow-url] "${team_name}": no match above threshold (best=${bestScore.toFixed(2)})`)
    return Response.json({ data: { zillow_url: null, reason: 'below_threshold' } })
  }

  const matchedName = bestResult.team_name ?? bestResult.business_name ?? bestResult.full_name ?? ''
  const confidence = bestScore >= HIGH_THRESHOLD ? 'high' : 'low'
  console.log(`[find-zillow-url] "${team_name}" → "${matchedName}" (score=${bestScore.toFixed(2)}, confidence=${confidence})`)

  return Response.json({
    data: {
      zillow_url: bestResult.profile_link,
      matched_name: matchedName,
      confidence,
    },
  })
}
