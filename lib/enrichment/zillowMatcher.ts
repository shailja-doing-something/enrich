import { distance } from 'fastest-levenshtein'
import { env } from '@/lib/env'
import { supabaseAdmin } from '@/lib/supabase/client'

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
  business_name?: string | null  // brokerage — do NOT use for name scoring
  full_name?: string | null
  address_state?: string | null
  is_team?: boolean | null
  team_size?: number | null
}

type ZillowApiResponse = {
  total: number
  results: ZillowResult[]
}

export type FindZillowResult = {
  zillow_url: string | null
  match_score: number
  matched_name: string | null
  source: 'table' | 'api' | 'none'
  rejection_reason?: 'no_results' | 'below_threshold' | 'chain_mismatch' | 'api_timeout'
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

// A result is a team record if any team indicator is present.
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

// Score all candidates and return the best one that clears all gates, or a rejection reason.
// KEY: name is scored only against team_name and full_name.
// business_name is the brokerage — scoring it against the team name causes false 100s
// when the input team name matches a brokerage (e.g. "Barrett Real Estate").
function scoreAndPick(
  results: ZillowResult[],
  teamName: string,
  brokerage: string
): { match: { result: ZillowResult; total: number; displayName: string } | null; reason: 'no_results' | 'below_threshold' | 'chain_mismatch' } {
  if (results.length === 0) return { match: null, reason: 'no_results' }

  type Scored = { result: ZillowResult; total: number; ns: number; bs: number; displayName: string }
  const scored: Scored[] = results.map(r => {
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
      `score=${s.total} (name=${s.ns}, brok=${s.bs})`
    )
  })

  const best = scored[0]

  if (best.ns < MIN_NAME_SCORE) {
    console.log(`[Zillow]   Best name score ${best.ns} < MIN_NAME_SCORE ${MIN_NAME_SCORE} — rejected`)
    return { match: null, reason: 'below_threshold' }
  }

  const inputChain = extractChain(brokerage)
  const resultChain = extractChain(best.result.business_name ?? '')
  if (inputChain && resultChain && inputChain !== resultChain) {
    console.log(`[Zillow]   Chain mismatch: ${inputChain} vs ${resultChain} — rejected`)
    return { match: null, reason: 'chain_mismatch' }
  }

  if (best.total < ACCEPT_THRESHOLD) {
    console.log(`[Zillow]   Total ${best.total} < ACCEPT_THRESHOLD ${ACCEPT_THRESHOLD} — rejected`)
    return { match: null, reason: 'below_threshold' }
  }

  return { match: best, reason: 'below_threshold' /* unused when match is non-null */ }
}

// Row shape returned by ce_search_zillow_candidates RPC
type TableRow = {
  profile_link: string
  full_name: string | null
  team_name: string | null
  business_name: string | null
  address_state: string | null
  address_city: string | null
  is_team: boolean | null
  team_member_count: number | null
}

// Query local staging table for team candidates in a given state.
// Returns empty array (never throws) — any error falls through to API.
async function searchLocalTable(
  state: string,
  withIsTeam: boolean
): Promise<ZillowResult[]> {
  const { data, error } = await supabaseAdmin
    .rpc('ce_search_zillow_candidates', { p_state: state, p_is_team: withIsTeam })
  if (error) {
    console.log(`[Zillow]   Table lookup error: ${error.message}`)
    return []
  }
  const rows = (data as TableRow[] | null) ?? []
  return rows.map(r => ({
    profile_link: r.profile_link,
    full_name: r.full_name,
    team_name: r.team_name,
    business_name: r.business_name,
    address_state: r.address_state,
    is_team: r.is_team,
    team_size: r.team_member_count,
  }))
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

// Cascade: sanitized name → name+brokerage → core token.
// Falls through to next pass only on 5xx/timeout; stops on 0 results (legitimate empty).
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

  if (state) {
    console.log(`[Zillow] ${team_name} (${state}) — checking local table first`)
  } else {
    console.log(`[Zillow] ${team_name} | no parseable state in "${location}" — skipping table, trying API`)
  }

  // SOURCE 1: Local staging table (fast, free — only when state is known)
  if (state !== null) {
    const tableResults = await searchLocalTable(state, true)
    console.log(`[Zillow]   Table (is_team=true, state=${state}): ${tableResults.length} candidates`)

    if (tableResults.length > 0) {
      const { match, reason } = scoreAndPick(tableResults, team_name, brokerage)
      if (match) {
        console.log(`[Zillow]   Decision: ACCEPTED (table) ${match.result.profile_link} — score=${match.total}`)
        return {
          zillow_url: match.result.profile_link,
          match_score: match.total,
          matched_name: match.displayName,
          source: 'table',
        }
      }
      console.log(`[Zillow]   Table: no match cleared gates (${reason}) — falling back to API`)
    } else {
      console.log(`[Zillow]   Table: 0 results — falling back to API`)
    }
  }

  // SOURCE 2: External Zillow API
  const apiKey = env.ZILLOW_ZIP_API_KEY

  // Primary: is_team=true
  const primary = await searchWithFallback(team_name, brokerage, state, apiKey, true)
  if (primary.apiTimeout) {
    console.log(`[Zillow]   Decision: REJECTED — api_timeout (primary)`)
    return { zillow_url: null, match_score: 0, matched_name: null, source: 'none', rejection_reason: 'api_timeout' }
  }

  let apiResults = primary.results

  // Secondary: some teams aren't tagged is_team in Zillow
  if (apiResults.length === 0) {
    const secondary = await searchWithFallback(team_name, brokerage, state, apiKey, false)
    if (secondary.apiTimeout) {
      console.log(`[Zillow]   Decision: REJECTED — api_timeout (secondary)`)
      return { zillow_url: null, match_score: 0, matched_name: null, source: 'none', rejection_reason: 'api_timeout' }
    }
    apiResults = secondary.results
  }

  if (apiResults.length === 0) {
    console.log(`[Zillow]   Decision: REJECTED — no_results`)
    return { zillow_url: null, match_score: 0, matched_name: null, source: 'none', rejection_reason: 'no_results' }
  }

  // Hard-reject solo agent records before scoring
  const teamApiResults = apiResults.filter(isTeamRecord)
  if (teamApiResults.length === 0) {
    console.log(`[Zillow]   Decision: REJECTED — no_results (all ${apiResults.length} API candidate(s) are solo agents)`)
    return { zillow_url: null, match_score: 0, matched_name: null, source: 'none', rejection_reason: 'no_results' }
  }
  if (teamApiResults.length < apiResults.length) {
    console.log(`[Zillow]   Filtered ${apiResults.length - teamApiResults.length} solo agent(s), ${teamApiResults.length} team record(s) remain`)
  }

  const { match, reason } = scoreAndPick(teamApiResults, team_name, brokerage)
  if (match) {
    console.log(`[Zillow]   Decision: ACCEPTED (api) ${match.result.profile_link} — score=${match.total}`)
    return {
      zillow_url: match.result.profile_link,
      match_score: match.total,
      matched_name: match.displayName,
      source: 'api',
    }
  }

  console.log(`[Zillow]   Decision: REJECTED — ${reason}`)
  return { zillow_url: null, match_score: 0, matched_name: null, source: 'none', rejection_reason: reason }
}
