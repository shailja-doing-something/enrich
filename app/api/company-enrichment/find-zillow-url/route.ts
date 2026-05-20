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

// Maps known brokerage name variants → canonical chain ID.
// Used for hard-reject when input and result chains are known and differ.
// NOTE: order matters — more specific patterns first.
const BROKERAGE_CHAIN_PATTERNS: Array<readonly [string, string]> = [
  ['keller williams', 'kw'],
  ['kellerwilliams', 'kw'],
  ['re/max', 'remax'],
  ['remax', 'remax'],
  ['coldwell banker', 'coldwellbanker'],
  ['compass', 'compass'],
  ['century 21', 'c21'],
  ['century21', 'c21'],
  ['berkshire hathaway', 'bhhs'],
  ['exp realty', 'exp'],
  ['eXp realty', 'exp'],
  ['exp realty', 'exp'],
  ['sotheby', 'sothebys'],
  ['engel', 'ev'],
  ['howard hanna', 'howardhanna'],
  ['john l. scott', 'johnlscott'],
  ['john l scott', 'johnlscott'],
  ['nexthome', 'nexthome'],
  ['realty one group', 'rog'],
  ['better homes', 'bhg'],
  ['exit realty', 'exit'],
]

// Accept only if combined score >= this
const ACCEPT_THRESHOLD = 0.60
// Marked high-confidence if >= this
const HIGH_THRESHOLD = 0.80
// Hard-reject any result with name score below this (regardless of other signals)
const MIN_NAME_SCORE = 0.35

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
  return Math.max(tokenOverlapRatio(nq, nc), fuzzySimScore(nq, nc))
}

// Parses "Denver CO" or "Austin, TX" → { city: "Denver", state: "CO" }
function parseLocation(location: string): { city: string; state: string } {
  const tokens = location.trim().replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  const last = tokens.at(-1) ?? ''
  const state = last.length === 2 ? last.toUpperCase() : ''
  const city = state ? tokens.slice(0, -1).join(' ') : tokens.join(' ')
  return { city, state }
}

// Returns the canonical chain ID if the brokerage string matches a known chain, else null
function extractChain(brokerage: string): string | null {
  const lower = brokerage.toLowerCase()
  for (const [pattern, chain] of BROKERAGE_CHAIN_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) return chain
  }
  return null
}

// Returns 'match' when both chains are known and equal,
//         'mismatch' when both are known and differ (hard-reject signal),
//         'unknown' when either is an unrecognized brokerage
function chainVote(inputBrokerage: string, resultBusiness: string): 'match' | 'mismatch' | 'unknown' {
  if (!inputBrokerage || !resultBusiness) return 'unknown'
  const a = extractChain(inputBrokerage)
  const b = extractChain(resultBusiness)
  if (!a || !b) return 'unknown'
  return a === b ? 'match' : 'mismatch'
}

// Strategy B (city+state) first → Strategy A (no geo, apply state filter client-side) fallback.
// brokerage= param is NOT sent to API — it causes timeouts; scored client-side instead.
async function fetchZillowCandidates(
  teamName: string,
  city: string,
  state: string,
  apiKey: string
): Promise<ZillowResult[]> {
  const headers = { 'x-api-key': apiKey }
  const baseParams: Record<string, string> = {
    q: teamName,
    is_team: 'true',
    full_profile: 'true',
    limit: '10',
  }

  // Strategy B: geo-constrained (city + state)
  if (city && state) {
    const url = new URL('https://zillow-zip.up.railway.app/api/agents/search')
    Object.entries({ ...baseParams, city, state }).forEach(([k, v]) => url.searchParams.set(k, v))
    const resp = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(8_000) })
    if (!resp.ok) throw new Error(`Zillow API ${resp.status}`)
    const data = (await resp.json()) as ZillowApiResponse
    if ((data.results ?? []).length > 0) return data.results
  }

  // Strategy A fallback: no geo filter — state hard-rejected client-side in scoreResult
  const url = new URL('https://zillow-zip.up.railway.app/api/agents/search')
  Object.entries(baseParams).forEach(([k, v]) => url.searchParams.set(k, v))
  const resp = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(8_000) })
  if (!resp.ok) throw new Error(`Zillow API ${resp.status}`)
  const data = (await resp.json()) as ZillowApiResponse
  return data.results ?? []
}

// Combined score for one Zillow result against the input team.
// Returns 0 for any hard-reject (state mismatch, chain mismatch, name too low).
// Formula: nameScore×0.60 + brokerageBonus×0.25 + cityBonus×0.15
function scoreResult(
  result: ZillowResult,
  teamName: string,
  inputBrokerage: string,
  inputCity: string,
  inputState: string
): number {
  // Hard reject: result state known and differs from input state
  if (inputState && result.address_state) {
    if (result.address_state.toUpperCase() !== inputState) return 0
  }

  // Name score: best of team_name vs business_name comparisons
  const teamScore = nameMatchScore(teamName, result.team_name ?? '')
  const bizScore = nameMatchScore(teamName, result.business_name ?? '')
  const nameScore = Math.max(teamScore, bizScore)

  // Hard reject: name similarity below floor
  if (nameScore < MIN_NAME_SCORE) return 0

  // Hard reject: brokerage chains are known and clearly differ
  const chain = chainVote(inputBrokerage, result.business_name ?? '')
  if (chain === 'mismatch') return 0

  const brokerageBonus = chain === 'match' ? 0.25 : 0

  const cityBonus = (
    inputCity.length > 0 &&
    (result.address_city ?? '').toLowerCase() === inputCity.toLowerCase()
  ) ? 0.15 : 0

  return nameScore * 0.60 + brokerageBonus + cityBonus
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
  const { team_name, location, brokerage } = parsed.data

  if (!team_name.trim()) {
    return Response.json({ data: { zillow_url: null, reason: 'empty_team_name' } })
  }

  const { city, state } = parseLocation(location)

  let results: ZillowResult[]
  try {
    results = await fetchZillowCandidates(team_name, city, state, env.ZILLOW_ZIP_API_KEY)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[find-zillow-url] fetch failed for "${team_name}": ${msg}`)
    return Response.json({ data: { zillow_url: null, reason: 'network_error' } })
  }

  if (results.length === 0) {
    return Response.json({ data: { zillow_url: null, reason: 'no_results' } })
  }

  let bestScore = -1
  let bestResult: ZillowResult | null = null

  for (const r of results) {
    const score = scoreResult(r, team_name, brokerage, city, state)
    if (score > bestScore) {
      bestScore = score
      bestResult = r
    }
  }

  if (!bestResult || bestScore < ACCEPT_THRESHOLD) {
    console.log(`[find-zillow-url] "${team_name}": no match above threshold (best=${bestScore.toFixed(2)})`)
    return Response.json({ data: { zillow_url: null, reason: 'below_threshold' } })
  }

  const matchedName = bestResult.team_name ?? bestResult.business_name ?? bestResult.full_name ?? ''
  const confidence = bestScore >= HIGH_THRESHOLD ? 'high' : 'low'
  console.log(
    `[find-zillow-url] "${team_name}" → "${matchedName}" ` +
    `(score=${bestScore.toFixed(2)}, confidence=${confidence}, ` +
    `state=${bestResult.address_state ?? '?'}, ` +
    `chain=${chainVote(brokerage, bestResult.business_name ?? '')})`
  )

  return Response.json({
    data: {
      zillow_url: bestResult.profile_link,
      matched_name: matchedName,
      confidence,
    },
  })
}
