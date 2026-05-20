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
const MIN_NAME_SCORE = 40   // gate: brokerage bonus cannot rescue a clearly wrong name
const ZILLOW_SEARCH_URL = 'https://zillow-zip.up.railway.app/api/agents/search'

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

// 'associates' added — its absence was causing "Nguyen & Associates" to match
// "Anna & Associates" (shared suffix inflated Levenshtein score to 45/70)
const NAME_STOP = new Set([
  'team', 'group', 'realty', 'real', 'estate', 'properties', 'property',
  'homes', 'home', 'associates', 'llc', 'inc', 'the', 'of', 'at', 'on', 'and',
])

// Used only for hard-reject: fires when BOTH sides are recognized chains and differ
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
  rejection_reason?: 'no_state' | 'no_results' | 'below_threshold' | 'chain_mismatch' | 'api_timeout'
}

function parseState(location: string): string | null {
  const tokens = location.trim().replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  const last = tokens.at(-1) ?? ''
  if (/^[A-Za-z]{2}$/.test(last)) return last.toUpperCase()
  for (let n = 3; n >= 1; n--) {
    const candidate = tokens.slice(-n).join(' ').toLowerCase()
    if (STATE_NAMES[candidate]) return STATE_NAMES[candidate]
  }
  return null
}

// Replace " & " with " and " and collapse whitespace — keeps apostrophes and hyphens.
// Applied to query parameter only; original is used for scoring.
function sanitizeQuery(name: string): string {
  return name
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Returns the longest non-stop token — used as last-resort query when full name times out.
function coreToken(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !NAME_STOP.has(t))
  return tokens.sort((a, b) => b.length - a.length)[0] ?? name.split(/\s+/)[0] ?? name
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

// Hard-reject solo agent records before scoring.
// A result qualifies as a team record if any of these are true:
//   • is_team flag is explicitly true
//   • has a team_name field (only populated on team profiles)
//   • business_name contains "team" or "group" (common for unlabeled team brokerages)
// Solo agents that slip through a secondary (no is_team filter) search are rejected here.
function isTeamRecord(r: ZillowResult): boolean {
  if (r.is_team) return true
  if (r.team_name && r.team_name.trim()) return true
  if (/\b(team|group)\b/i.test(r.business_name ?? '')) return true
  return false
}

function extractChain(s: string): string | null {
  for (const [pattern, chain] of CHAIN_PATTERNS) {
    if (pattern.test(s)) return chain
  }
  return null
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Single search pass with up to 3 attempts (1s / 3s backoff) on 5xx or network error.
// Returns { results, timedOut: true } only after all retries are exhausted on 5xx.
async function attemptSearch(
  q: string,
  state: string,
  apiKey: string,
  withIsTeam: boolean,
  passLabel: string
): Promise<{ results: ZillowResult[]; timedOut: boolean }> {
  const params = new URLSearchParams({ q, state, full_profile: 'true', limit: '20' })
  if (withIsTeam) params.set('is_team', 'true')
  const url = `${ZILLOW_SEARCH_URL}?${params.toString()}`
  const headers = { 'x-api-key': apiKey }

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await sleep(attempt === 2 ? 1000 : 3000)
    try {
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
      if (resp.ok) {
        const data = (await resp.json()) as ZillowApiResponse
        const count = (data.results ?? []).length
        console.log(`[Zillow]   ${passLabel}: HTTP ${resp.status}, ${count} results`)
        return { results: data.results ?? [], timedOut: false }
      }
      const body = await resp.text().catch(() => '')
      console.log(
        `[Zillow]   ${passLabel}: HTTP ${resp.status} (attempt ${attempt}/3)` +
        (body ? ` — ${body.slice(0, 100)}` : '')
      )
      if (resp.status < 500) return { results: [], timedOut: false }  // 4xx won't recover
      if (attempt === 3) return { results: [], timedOut: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[Zillow]   ${passLabel}: network error (attempt ${attempt}/3) — ${msg.slice(0, 100)}`)
      if (attempt === 3) return { results: [], timedOut: true }
    }
  }
  return { results: [], timedOut: true }
}

// Cascade: sanitized name → name+brokerage → core token.
// Falls through to next pass only on 5xx/timeout; stops on 0 results (legitimate empty).
async function searchWithFallback(
  teamName: string,
  brokerage: string,
  state: string,
  apiKey: string,
  withIsTeam: boolean
): Promise<{ results: ZillowResult[]; apiTimeout: boolean }> {
  const sanitized = sanitizeQuery(teamName)
  const label = withIsTeam ? '' : ' (no is_team)'

  // Pass 1: sanitized team name
  const r1 = await attemptSearch(sanitized, state, apiKey, withIsTeam, `Pass 1 (name${label})`)
  if (!r1.timedOut) return { results: r1.results, apiTimeout: false }

  // Pass 2: sanitized name + brokerage — different query path in API
  const q2 = brokerage ? `${sanitized} ${sanitizeQuery(brokerage)}` : sanitized
  const r2 = await attemptSearch(q2, state, apiKey, withIsTeam, `Pass 2 (name+brokerage${label})`)
  if (!r2.timedOut) return { results: r2.results, apiTimeout: false }

  // Pass 3: core distinctive token only
  const core = coreToken(teamName)
  const r3 = await attemptSearch(core, state, apiKey, withIsTeam, `Pass 3 (core token "${core}"${label})`)
  if (!r3.timedOut) return { results: r3.results, apiTimeout: false }

  return { results: [], apiTimeout: true }
}

async function findZillowUrl(input: {
  team_name: string
  brokerage: string
  location: string
}): Promise<FindZillowResult> {
  const { team_name, brokerage, location } = input
  const state = parseState(location)

  if (!state) {
    console.log(`[Zillow] ${team_name} | ${brokerage} | (no state) — skipping`)
    console.log(`[Zillow]   Decision: REJECTED — no_state`)
    return { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'no_state' }
  }

  console.log(`[Zillow] ${team_name} (${state}) — attempting search`)

  const apiKey = env.ZILLOW_ZIP_API_KEY

  // Primary: is_team=true
  const primary = await searchWithFallback(team_name, brokerage, state, apiKey, true)
  if (primary.apiTimeout) {
    console.log(`[Zillow]   Decision: REJECTED — api_timeout`)
    return { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'api_timeout' }
  }

  let results = primary.results

  // Secondary: some teams aren't tagged is_team in Zillow
  if (results.length === 0) {
    const secondary = await searchWithFallback(team_name, brokerage, state, apiKey, false)
    if (secondary.apiTimeout) {
      console.log(`[Zillow]   Decision: REJECTED — api_timeout`)
      return { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'api_timeout' }
    }
    results = secondary.results
  }

  if (results.length === 0) {
    console.log(`[Zillow]   Decision: REJECTED — no_results`)
    return { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'no_results' }
  }

  // Hard-reject solo agent records before scoring — keeps only team profiles
  const teamResults = results.filter(isTeamRecord)
  if (teamResults.length === 0) {
    console.log(`[Zillow]   Decision: REJECTED — no_results (all ${results.length} candidate(s) are solo agent profiles)`)
    return { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'no_results' }
  }
  if (teamResults.length < results.length) {
    console.log(`[Zillow]   Filtered ${results.length - teamResults.length} solo agent record(s), ${teamResults.length} team record(s) remain`)
  }
  results = teamResults

  type Scored = { result: ZillowResult; total: number; ns: number; bs: number; displayName: string }
  const scored: Scored[] = results.map(r => {
    const displayName = r.team_name ?? r.business_name ?? r.full_name ?? ''
    const ns = Math.max(
      calcNameScore(team_name, r.team_name ?? ''),
      calcNameScore(team_name, r.business_name ?? ''),
      calcNameScore(team_name, r.full_name ?? '')
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

  // Gate: name score must clear minimum before brokerage bonus is considered
  if (best.ns < MIN_NAME_SCORE) {
    console.log(`[Zillow]   Decision: REJECTED — name score ${best.ns} below minimum ${MIN_NAME_SCORE}`)
    return { zillow_url: null, match_score: best.total, matched_name: best.displayName, rejection_reason: 'below_threshold' }
  }

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
    return Response.json({ data: { zillow_url: null, match_score: 0, matched_name: null, rejection_reason: 'api_timeout' } })
  }

  return Response.json({ data: result })
}
