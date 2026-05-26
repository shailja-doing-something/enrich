import { distance } from 'fastest-levenshtein'
import { env } from '@/lib/env'

export const ACCEPT_THRESHOLD = 50
export const MIN_NAME_SCORE = 40   // gate: brokerage bonus cannot rescue a clearly wrong name
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

export type ZillowResult = {
  profile_link: string
  team_name?: string | null
  business_name?: string | null  // this is the brokerage name, not the team — do NOT use for name scoring
  full_name?: string | null
  address_state?: string | null
  is_team?: boolean
  team_size?: number | null
}

type ZillowApiResponse = {
  total: number
  results: ZillowResult[]
}

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'
export type MatchType = 'team' | 'individual_agent' | 'none'

export type FindZillowResult = {
  zillow_url: string | null
  match_score: number
  matched_name: string | null
  match_confidence: MatchConfidence
  match_type: MatchType
  rejection_reason?: 'no_state' | 'no_results' | 'below_threshold' | 'chain_mismatch' | 'api_timeout'
}

export function parseState(location: string): string | null {
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
export function sanitizeQuery(name: string): string {
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

export function calcNameScore(input: string, candidate: string): number {
  const a = normalize(input)
  const b = normalize(candidate)
  if (!a || !b) return 0
  const maxLen = Math.max(a.length, b.length)
  return Math.round(70 * (1 - distance(a, b) / maxLen))
}

export function calcBrokerageScore(inputBrokerage: string, resultBusiness: string): number {
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

// A result is a team record if it has any team indicators.
// Used to classify match_type — no longer used to hard-reject candidates.
export function isTeamRecord(r: ZillowResult): boolean {
  if (r.is_team) return true
  if (r.team_name && r.team_name.trim()) return true
  if (r.team_size !== undefined && r.team_size !== null && r.team_size > 1) return true
  if (/\b(team|group)\b/i.test(r.business_name ?? '')) return true
  return false
}

function extractChain(s: string): string | null {
  for (const [pattern, chain] of CHAIN_PATTERNS) {
    if (pattern.test(s)) return chain
  }
  return null
}

// Confidence rules (applied after a match is accepted):
//   high   → score ≥ 75 AND result is a team record AND state was known
//   medium → score 60–74 AND team, OR score ≥ 75 AND solo/no-state
//   low    → everything else that cleared ACCEPT_THRESHOLD
function calcConfidence(
  score: number,
  isTeam: boolean,
  noState: boolean
): 'high' | 'medium' | 'low' {
  if (noState) return 'low'
  if (score >= 75 && isTeam) return 'high'
  if (score >= 60 && isTeam) return 'medium'
  if (score >= 75) return 'medium'   // solo agent with strong name match
  return 'low'
}

type ScoredResult = {
  result: ZillowResult
  total: number
  ns: number
  bs: number
  displayName: string
}

type GateOutcome =
  | { match: ScoredResult; rejectionReason: undefined }
  | { match: null; rejectionReason: 'no_results' | 'below_threshold' | 'chain_mismatch' }

// Score all candidates and return the best one that clears all gates, or null.
// KEY FIX: name is scored only against team_name and full_name.
// business_name is the brokerage field — scoring team names against it causes
// false 100s whenever the input team name happens to match a brokerage name.
function bestScoredMatch(
  results: ZillowResult[],
  teamName: string,
  brokerage: string
): GateOutcome {
  if (results.length === 0) return { match: null, rejectionReason: 'no_results' }

  const scored: ScoredResult[] = results.map(r => {
    // business_name intentionally excluded from name scoring — it is the brokerage
    const ns = Math.max(
      calcNameScore(teamName, r.team_name ?? ''),
      calcNameScore(teamName, r.full_name ?? '')
    )
    const bs = calcBrokerageScore(brokerage, r.business_name ?? '')
    const displayName = r.team_name ?? r.full_name ?? r.business_name ?? ''
    return { result: r, total: ns + bs, ns, bs, displayName }
  })
  scored.sort((a, b) => b.total - a.total)

  console.log(`[Zillow]   Top ${Math.min(3, scored.length)} candidates:`)
  scored.slice(0, 3).forEach((s, i) => {
    console.log(
      `[Zillow]     ${i + 1}. "${s.displayName}" | brok="${s.result.business_name ?? ''}" | ` +
      `score=${s.total} (name=${s.ns}, brok=${s.bs}) isTeam=${isTeamRecord(s.result)}`
    )
  })

  const best = scored[0]

  if (best.ns < MIN_NAME_SCORE) {
    console.log(`[Zillow]   Best name score ${best.ns} < MIN_NAME_SCORE ${MIN_NAME_SCORE} — rejected`)
    return { match: null, rejectionReason: 'below_threshold' }
  }

  const inputChain = extractChain(brokerage)
  const resultChain = extractChain(best.result.business_name ?? '')
  if (inputChain && resultChain && inputChain !== resultChain) {
    console.log(`[Zillow]   Chain mismatch: ${inputChain} vs ${resultChain} — rejected`)
    return { match: null, rejectionReason: 'chain_mismatch' }
  }

  if (best.total < ACCEPT_THRESHOLD) {
    console.log(`[Zillow]   Total ${best.total} < ACCEPT_THRESHOLD ${ACCEPT_THRESHOLD} — rejected`)
    return { match: null, rejectionReason: 'below_threshold' }
  }

  return { match: best, rejectionReason: undefined }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Single search pass with up to 3 attempts (1s / 3s backoff) on 5xx or network error.
async function attemptSearch(
  q: string,
  state: string | null,
  apiKey: string,
  withIsTeam: boolean,
  passLabel: string
): Promise<{ results: ZillowResult[]; timedOut: boolean }> {
  const params = new URLSearchParams({ q, full_profile: 'true', limit: '20' })
  if (state) params.set('state', state)
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
      if (resp.status < 500) return { results: [], timedOut: false }
      if (attempt === 3) return { results: [], timedOut: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[Zillow]   ${passLabel}: network error (attempt ${attempt}/3) — ${msg.slice(0, 100)}`)
      if (attempt === 3) return { results: [], timedOut: true }
    }
  }
  return { results: [], timedOut: true }
}

// Three-pass cascade (sanitized name → name+brokerage → core token).
// Falls through to next pass only on 5xx/timeout; stops on legitimate 0 results.
async function searchWithFallback(
  teamName: string,
  brokerage: string,
  state: string | null,
  apiKey: string,
  withIsTeam: boolean
): Promise<{ results: ZillowResult[]; apiTimeout: boolean }> {
  const sanitized = sanitizeQuery(teamName)
  const label = withIsTeam ? '' : ' (no is_team)'

  const r1 = await attemptSearch(sanitized, state, apiKey, withIsTeam, `Pass 1 (name${label})`)
  if (!r1.timedOut) return { results: r1.results, apiTimeout: false }

  const q2 = brokerage ? `${sanitized} ${sanitizeQuery(brokerage)}` : sanitized
  const r2 = await attemptSearch(q2, state, apiKey, withIsTeam, `Pass 2 (name+brokerage${label})`)
  if (!r2.timedOut) return { results: r2.results, apiTimeout: false }

  const core = coreToken(teamName)
  const r3 = await attemptSearch(core, state, apiKey, withIsTeam, `Pass 3 (core token "${core}"${label})`)
  if (!r3.timedOut) return { results: r3.results, apiTimeout: false }

  return { results: [], apiTimeout: true }
}

export async function findZillowUrl(input: {
  team_name: string
  brokerage: string
  location: string
}): Promise<FindZillowResult> {
  const { team_name, brokerage, location } = input
  const state = parseState(location)
  const noState = state === null

  if (noState) {
    console.log(`[Zillow] ${team_name} | no parseable state in "${location}" — attempting without state filter`)
  } else {
    console.log(`[Zillow] ${team_name} (${state}) — attempting search`)
  }

  const apiKey = env.ZILLOW_ZIP_API_KEY

  // PRIMARY: is_team=true
  const primary = await searchWithFallback(team_name, brokerage, state, apiKey, true)
  if (primary.apiTimeout) {
    console.log(`[Zillow]   Decision: REJECTED — api_timeout (primary)`)
    return { zillow_url: null, match_score: 0, matched_name: null, match_confidence: 'none', match_type: 'none', rejection_reason: 'api_timeout' }
  }

  const primaryOutcome = bestScoredMatch(primary.results, team_name, brokerage)
  if (primaryOutcome.match) {
    const m = primaryOutcome.match
    const isTeam = isTeamRecord(m.result)
    const conf = calcConfidence(m.total, isTeam, noState)
    console.log(`[Zillow]   Decision: ACCEPTED (primary) ${m.result.profile_link} — score=${m.total} conf=${conf} type=${isTeam ? 'team' : 'individual_agent'}`)
    return {
      zillow_url: m.result.profile_link,
      match_score: m.total,
      matched_name: m.displayName,
      match_confidence: conf,
      match_type: isTeam ? 'team' : 'individual_agent',
    }
  }

  // FALLBACK: no is_team filter — runs even when primary returned results that failed gates
  console.log(`[Zillow]   Primary: no match cleared gates (${primaryOutcome.rejectionReason}) — trying fallback`)
  const fallback = await searchWithFallback(team_name, brokerage, state, apiKey, false)
  if (fallback.apiTimeout) {
    console.log(`[Zillow]   Decision: REJECTED — api_timeout (fallback)`)
    return { zillow_url: null, match_score: 0, matched_name: null, match_confidence: 'none', match_type: 'none', rejection_reason: 'api_timeout' }
  }

  const fallbackOutcome = bestScoredMatch(fallback.results, team_name, brokerage)
  if (fallbackOutcome.match) {
    const m = fallbackOutcome.match
    const isTeam = isTeamRecord(m.result)
    // Cap fallback matches at medium — primary not finding them is a weaker signal
    const rawConf = calcConfidence(m.total, isTeam, noState)
    const conf = rawConf === 'high' ? 'medium' : rawConf
    console.log(`[Zillow]   Decision: ACCEPTED (fallback) ${m.result.profile_link} — score=${m.total} conf=${conf} type=${isTeam ? 'team' : 'individual_agent'}`)
    return {
      zillow_url: m.result.profile_link,
      match_score: m.total,
      matched_name: m.displayName,
      match_confidence: conf,
      match_type: isTeam ? 'team' : 'individual_agent',
    }
  }

  // Determine final rejection reason: prefer chain_mismatch > below_threshold > no_results
  const reasons = [primaryOutcome.rejectionReason, fallbackOutcome.rejectionReason]
  const rejectionReason =
    reasons.includes('chain_mismatch') ? 'chain_mismatch' :
    reasons.includes('below_threshold') ? 'below_threshold' :
    'no_results'

  console.log(`[Zillow]   Decision: REJECTED — ${rejectionReason}`)
  return {
    zillow_url: null,
    match_score: 0,
    matched_name: null,
    match_confidence: 'none',
    match_type: 'none',
    rejection_reason: rejectionReason,
  }
}
