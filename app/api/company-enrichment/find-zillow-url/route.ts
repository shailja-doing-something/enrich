import { NextRequest } from 'next/server'
import { z } from 'zod'
import { distance } from 'fastest-levenshtein'
import { env } from '@/lib/env'

const bodySchema = z.object({
  team_name: z.string(),
  location: z.string().default(''),
  brokerage: z.string().default(''),
})

const ACCEPT_THRESHOLD = 50

const STATE_NAMES: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
}

const NAME_STOP = new Set([
  'team', 'group', 'realty', 'real', 'estate', 'properties', 'property',
  'homes', 'home', 'llc', 'inc', 'the', 'of', 'at', 'on', 'and',
])

// Used only for hard-reject: fires when BOTH sides are recognized chains and they differ
const CHAIN_PATTERNS: Array<readonly [RegExp, string]> = [
  [/keller\s*williams/i, 'kw'],
  [/re\s*\/?\s*max/i, 'remax'],
  [/coldwell\s*banker/i, 'coldwellbanker'],
  [/\bcompass\b/i, 'compass'],
  [/century\s*21/i, 'c21'],
  [/berkshire\s*hathaway/i, 'bhhs'],
  [/exp\s+realty/i, 'exp'],
  [/sotheby/i, 'sothebys'],
  [/engel.*v.lkers/i, 'ev'],
  [/howard\s*hanna/i, 'howardhanna'],
  [/long\s*(and|&)\s*foster/i, 'longfoster'],
  [/weichert/i, 'weichert'],
]

type ZillowResult = {
  profile_link: string
  team_name?: string | null
  business_name?: string | null
  full_name?: string | null
  address_state?: string | null
  is_team?: boolean
}

type ZillowApiResponse = {
  total: number
  results: ZillowResult[]
}

export type FindZillowResult = {
  zillow_url: string | null
  match_score: number
  matched_name: string | null
  rejection_reason?: 'no_state' | 'no_results' | 'below_threshold' | 'chain_mismatch'
}

function parseState(location: string): string | null {
  const tokens = location.trim().replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  // Last token as 2-letter code
  const last = tokens.at(-1) ?? ''
  if (/^[A-Za-z]{2}$/.test(last)) return last.toUpperCase()
  // Last 1–3 tokens as full state name
  for (let n = 3; n >= 1; n--) {
    const candidate = tokens.slice(-n).join(' ').toLowerCase()
    if (STATE_NAMES[candidate]) return STATE_NAMES[candidate]
  }
  return null
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0 && !NAME_STOP.has(t))
    .join(' ')
    .trim()
}

function calcNameScore(input: string, candidate: string): number {
  const a = normalize(input)
  const b = normalize(candidate)
  if (!a || !b) return 0
  const maxLen = Math.max(a.length, b.length)
  return Math.round(70 * (1 - distance(a, b) / maxLen))
}

function calcBrokerageScore(inputBrokerage: string, resultBusiness: string): number {
  if (!inputBrokerage || !resultBusiness) return 0
  const a = normalize(inputBrokerage)
  const b = normalize(resultBusiness)
  if (!a || !b) return 0
  if (a === b) return 30
  if (a.includes(b) || b.includes(a)) return 20
  const tokA = a.split(/\s+/)
  const tokB = b.split(/\s+/)
  if (tokA.some(t => t.length > 2 && tokB.includes(t))) return 10
  return 0
}

function extractChain(s: string): string | null {
  for (const [pattern, chain] of CHAIN_PATTERNS) {
    if (pattern.test(s)) return chain
  }
  return null
}

async function searchZillow(
  teamName: string,
  state: string,
  apiKey: string,
  withIsTeam: boolean
): Promise<ZillowResult[]> {
  const params = new URLSearchParams({ q: teamName, state, full_profile: 'true', limit: '20' })
  if (withIsTeam) params.set('is_team', 'true')
  const resp = await fetch(
    `https://zillow-zip.up.railway.app/api/agents/search?${params.toString()}`,
    { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000) }
  )
  if (!resp.ok) throw new Error(`Zillow API ${resp.status}`)
  return ((await resp.json()) as ZillowApiResponse).results ?? []
}

async function findZillowUrl(input: {
  team_name: string
  brokerage: string
  location: string
}): Promise<FindZillowResult> {
  const { team_name, brokerage, location } = input
  const state = parseState(location)

  if (!state) {
    console.log(`[Zillow] ${team_name} | ${brokerage} | (no state)`)
    console.log(`[Zillow]   Decision: REJECTED — no_state`)
    return { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'no_state' }
  }

  console.log(`[Zillow] ${team_name} | ${brokerage} | ${state}`)

  const apiKey = env.ZILLOW_ZIP_API_KEY
  let results = await searchZillow(team_name, state, apiKey, true)
  console.log(`[Zillow]   Search returned ${results.length} results`)

  // Fallback: some teams are not tagged is_team in Zillow
  if (results.length === 0) {
    results = await searchZillow(team_name, state, apiKey, false)
    console.log(`[Zillow]   Fallback (no is_team) returned ${results.length} results`)
  }

  if (results.length === 0) {
    console.log(`[Zillow]   Decision: REJECTED — no_results`)
    return { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'no_results' }
  }

  type Scored = { result: ZillowResult; total: number; ns: number; bs: number; displayName: string }
  const scored: Scored[] = results.map(r => {
    const displayName = r.team_name ?? r.business_name ?? r.full_name ?? ''
    const ns = Math.max(
      calcNameScore(team_name, r.team_name ?? ''),
      calcNameScore(team_name, r.business_name ?? '')
    )
    const bs = calcBrokerageScore(brokerage, r.business_name ?? '')
    return { result: r, total: ns + bs, ns, bs, displayName }
  })
  scored.sort((a, b) => b.total - a.total)

  console.log(`[Zillow]   Top ${Math.min(3, scored.length)} candidates:`)
  scored.slice(0, 3).forEach((s, i) => {
    console.log(
      `[Zillow]     ${i + 1}. ${s.displayName} | ${s.result.business_name ?? ''} | ` +
      `score=${s.total} (name=${s.ns}, brok=${s.bs})`
    )
  })

  const best = scored[0]

  const inputChain = extractChain(brokerage)
  const resultChain = extractChain(best.result.business_name ?? '')
  if (inputChain && resultChain && inputChain !== resultChain) {
    console.log(`[Zillow]   Decision: REJECTED — chain mismatch (${inputChain} vs ${resultChain})`)
    return { zillow_url: null, match_score: best.total, matched_name: best.displayName, rejection_reason: 'chain_mismatch' }
  }

  if (best.total < ACCEPT_THRESHOLD) {
    console.log(`[Zillow]   Decision: REJECTED — top score ${best.total} below threshold ${ACCEPT_THRESHOLD}`)
    return { zillow_url: null, match_score: best.total, matched_name: best.displayName, rejection_reason: 'below_threshold' }
  }

  console.log(`[Zillow]   Decision: ACCEPTED ${best.result.profile_link} (score=${best.total})`)
  return { zillow_url: best.result.profile_link, match_score: best.total, matched_name: best.displayName }
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
    return Response.json({ data: { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'no_state' } })
  }

  let result: FindZillowResult
  try {
    result = await findZillowUrl({ team_name, brokerage, location })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Zillow] fetch error for "${team_name}": ${msg}`)
    return Response.json({ data: { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'no_results' } })
  }

  return Response.json({ data: result })
}
