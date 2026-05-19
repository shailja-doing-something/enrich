import { distance } from 'fastest-levenshtein'
import type { EnrichRow, GenericFormattedRow } from '../supabase/types'

// ── Public types ──────────────────────────────────────────────────────────────

export type PriorityTier = 'P1' | 'P2' | 'P3' | 'Rejected' | 'Excluded'

export type QaSummary = {
  p1: number
  p2: number
  p3: number
  excluded: number
  rejected: number
  total: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'aol.com', 'msn.com', 'live.com',
  'me.com', 'mac.com', 'comcast.net', 'sbcglobal.net',
  'bellsouth.net', 'verizon.net', 'att.net', 'cox.net',
])

// Stripped before token comparison to isolate core identity tokens
const MATCH_STOP_WORDS = new Set([
  'realty', 'real', 'estate', 'properties', 'property', 'group', 'team',
  'homes', 'home', 'associates', 'llc', 'inc', 'ltd', 'corp', 'co', 'the',
  'of', 'at', 'on', 'and', 'in', 'by', 'brokered',
])

const RE_SIGNALS = [
  'realty', 'realtor', 'real estate', 'brokerage', 'properties', 'property',
  'homes', 'home', 'housing', 'residential', 'commercial', 'listing', 'listings',
  'keller williams', 're/max', 'coldwell', 'compass', 'exp realty', 'century 21',
  'berkshire', 'sotheby', 'better homes', 'howard hanna', 'long & foster',
  'weichert', 'zillow', 'realogy', 'lpt realty', 'place real estate',
]

const SAAS_SIGNALS = [
  'saas', 'software', 'technology', 'tech', 'platform', 'api', 'cloud', 'app',
  'digital', 'media', 'marketing agency', 'advertising', 'consulting firm',
  'staffing', 'recruiting', 'insurance', 'mortgage company', 'fintech', 'startup',
  'venture', 'fund', 'healthcare', 'hospital', 'clinic', 'pharmacy', 'legal',
  'law firm', 'accounting',
]

const SAAS_DOMAIN_PREFIXES = new Set([
  'hubspot', 'salesforce', 'stripe', 'twilio', 'slack', 'notion', 'linear',
  'figma', 'vercel', 'netlify', 'supabase', 'openai', 'anthropic', 'google',
  'microsoft', 'apple', 'amazon', 'meta', 'adobe',
])

const SAAS_TLDS = new Set(['.io', '.ai', '.app', '.tech', '.software', '.cloud', '.dev', '.api'])

const TIER_ORDER: Record<string, number> = { P1: 0, P2: 1, P3: 2 }

// ── Email helpers ─────────────────────────────────────────────────────────────

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : ''
}

function isWorkEmail(email: string): boolean {
  if (!email) return false
  const domain = emailDomain(email)
  return domain !== '' && !PERSONAL_DOMAINS.has(domain)
}

function inferFromDomain(domain: string): { website: string; company: string } {
  if (!domain) return { website: '', company: '' }
  const prefix = domain.split('.')[0] ?? ''
  return { website: domain, company: prefix }
}

// ── RE / SaaS signal detection ────────────────────────────────────────────────

function hasRESignal(text: string): boolean {
  const lower = text.toLowerCase()
  return RE_SIGNALS.some(s => lower.includes(s))
}

function hasSaaSSignal(text: string, domain: string): boolean {
  const lower = text.toLowerCase()
  if (SAAS_SIGNALS.some(s => lower.includes(s))) return true
  if (domain) {
    const prefix = domain.split('.')[0] ?? ''
    if (SAAS_DOMAIN_PREFIXES.has(prefix)) return true
    const tld = '.' + (domain.split('.').at(-1) ?? '')
    if (SAAS_TLDS.has(tld)) return true
  }
  return false
}

// ── Fuzzy matching (team dedup + company mismatch) ────────────────────────────

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

// Two team names refer to the same entity if any of these three conditions hold.
function isSameTeam(a: string, b: string): boolean {
  if (!a || !b) return false
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  if (!na || !nb) return false
  // Condition A: one normalized name is a substring of the other
  if (na.includes(nb) || nb.includes(na)) return true
  // Condition B: 70%+ token overlap from the shorter name's tokens
  if (tokenOverlapRatio(na, nb) >= 0.7) return true
  // Condition C: very high Levenshtein similarity (catches preposition/minor word variation)
  if (fuzzySimScore(na, nb) >= 0.85) return true
  return false
}

// Returns a map from each input team name to its canonical (longest matching) form.
function buildCanonicalMap(teamNames: string[]): Map<string, string> {
  const unique = Array.from(new Set(teamNames.filter(Boolean)))
  const groups: string[][] = []

  for (const name of unique) {
    let placed = false
    for (const group of groups) {
      if (group.some(g => isSameTeam(g, name))) {
        group.push(name)
        placed = true
        break
      }
    }
    if (!placed) groups.push([name])
  }

  const map = new Map<string, string>()
  for (const group of groups) {
    const canonical = group.reduce((a, b) => (a.length >= b.length ? a : b))
    for (const name of group) map.set(name, canonical)
  }
  return map
}

// A mismatch is when the inferred company (from email domain) and the provided
// team/brokerage name are clearly different entities — not substrings, low token
// overlap, and low Levenshtein similarity.
function isCompanyMismatch(inferred: string, provided: string): boolean {
  if (!inferred || !provided) return false
  const ni = normalizeForMatch(inferred)
  const np = normalizeForMatch(provided)
  if (!ni || !np) return false
  if (ni.includes(np) || np.includes(ni)) return false
  if (tokenOverlapRatio(ni, np) >= 0.5) return false
  if (fuzzySimScore(ni, np) >= 0.7) return false
  return true
}

// ── Core row classifier ───────────────────────────────────────────────────────

type RowFields = {
  email: string
  phone: string
  teamNameRaw: string
  brokerage: string
  website: string
}

type Classification = {
  priority_tier: PriorityTier
  rejected: boolean
  rejection_reason: string
  needs_review: boolean
  work_email: boolean
  inferred_website: string
  inferred_company: string
}

function classifyRow(fields: RowFields, teamNameNormalized: string): Classification {
  const { email, phone, teamNameRaw, brokerage, website } = fields
  const domain = emailDomain(email)

  // Step 0 — Fello exclusion (checks raw team name and email domain)
  // Word boundary match prevents "fellow" or "Fellowstone" from triggering exclusion
  if (domain.includes('fello') || /\bfello\b/i.test(teamNameRaw)) {
    return {
      priority_tier: 'Excluded',
      rejected: true,
      rejection_reason: 'Internal Fello record — excluded from processing',
      needs_review: false,
      work_email: false,
      inferred_website: '',
      inferred_company: '',
    }
  }

  // Step 3 — Email classification
  const hasEmail = email.length > 0
  const workEmail = hasEmail && isWorkEmail(email)

  // Step 4 — Infer website + company from work email domain
  const { website: inferredWebsite, company: inferredCompany } = workEmail
    ? inferFromDomain(domain)
    : { website: '', company: '' }

  // Step 2 — Real estate validation (union of all available text signals)
  const allText = [teamNameNormalized, brokerage, website, inferredCompany, inferredWebsite].join(' ')
  const reValidated = hasRESignal(allText)

  if (!reValidated) {
    if (hasSaaSSignal(allText, domain)) {
      return {
        priority_tier: 'Rejected',
        rejected: true,
        rejection_reason: 'Non-real-estate company detected',
        needs_review: false,
        work_email: workEmail,
        inferred_website: inferredWebsite,
        inferred_company: inferredCompany,
      }
    }
    // Ambiguous — no RE signal, no SaaS signal → P3 for human review
    return {
      priority_tier: 'P3',
      rejected: false,
      rejection_reason: 'Ambiguous real estate context',
      needs_review: true,
      work_email: workEmail,
      inferred_website: inferredWebsite,
      inferred_company: inferredCompany,
    }
  }

  // RE validated — now apply priority decision tree

  // No email → P3
  if (!hasEmail) {
    return {
      priority_tier: 'P3',
      rejected: false,
      rejection_reason: 'No email address',
      needs_review: false,
      work_email: false,
      inferred_website: '',
      inferred_company: '',
    }
  }

  // Step 5 — Phone validation
  const phoneDigits = phone.replace(/\D/g, '')
  const normalizedPhone = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits
  const phoneValid =
    normalizedPhone.length === 10 ? 'Yes' :
    normalizedPhone.length >= 7  ? 'Degraded' :
    'No'

  // Step 6 — Company mismatch (work email only)
  const mismatch = workEmail && inferredCompany
    ? isCompanyMismatch(inferredCompany, teamNameNormalized || brokerage)
    : false

  // Step 7 — Priority tier
  let tier: PriorityTier
  let needsReview = false

  if (workEmail) {
    if (phoneValid === 'Yes' && !mismatch) {
      tier = 'P1'
    } else if (phoneValid === 'Yes' && mismatch) {
      tier = 'P2'
      needsReview = true
    } else {
      // 7–9 digit phone or no phone with work email → P2
      tier = 'P2'
    }
  } else {
    // Personal email
    if (phoneValid === 'Yes' || phoneValid === 'Degraded') {
      tier = 'P2'
    } else {
      tier = 'P3'
    }
  }

  return {
    priority_tier: tier,
    rejected: false,
    rejection_reason: mismatch ? 'Company name mismatch between email domain and provided team/brokerage' : '',
    needs_review: needsReview,
    work_email: workEmail,
    inferred_website: inferredWebsite,
    inferred_company: inferredCompany,
  }
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Runs all QA steps (Fello exclusion, team dedup, RE validation, email/phone
 * classification, company mismatch) on a set of rows and returns them with the
 * eight QA flag fields populated. Pure — no I/O side effects.
 *
 * Output is sorted P1 → P2 → P3; Excluded and Rejected are placed last.
 */
export function prioritizeRows(rows: EnrichRow[]): EnrichRow[] {
  // Step 1 — Team name deduplication across all rows in the ticket
  const canonicalMap = buildCanonicalMap(rows.map(r => r.formatted_input?.team_name ?? ''))

  const classified = rows.map(row => {
    const fi = row.formatted_input
    const teamNameRaw = fi?.team_name ?? ''
    const teamNameNormalized = canonicalMap.get(teamNameRaw) ?? teamNameRaw

    const result = classifyRow(
      {
        email:       fi?.email    ?? '',
        phone:       fi?.phone    ?? '',
        teamNameRaw,
        brokerage:   fi?.brokerage ?? '',
        website:     fi?.website  ?? '',
      },
      teamNameNormalized,
    )

    return {
      ...row,
      team_name_normalized: teamNameNormalized,
      priority_tier:    result.priority_tier,
      rejected:         result.rejected,
      rejection_reason: result.rejection_reason,
      needs_review:     result.needs_review,
      work_email:       result.work_email,
      inferred_website: result.inferred_website,
      inferred_company: result.inferred_company,
    }
  })

  // Sort: P1 → P2 → P3 first; Excluded/Rejected appended after
  const enrichable = classified.filter(r => r.priority_tier in TIER_ORDER)
  const excluded   = classified.filter(r => r.priority_tier === 'Excluded')
  const rejected   = classified.filter(r => r.priority_tier === 'Rejected')

  enrichable.sort(
    (a, b) => (TIER_ORDER[a.priority_tier ?? 'P3'] ?? 2) - (TIER_ORDER[b.priority_tier ?? 'P3'] ?? 2)
  )

  return [...enrichable, ...excluded, ...rejected]
}

/**
 * Lightweight summary of QA tier counts for UI preview. Operates on
 * GenericFormattedRow (the preview sample) so it can be called in a client
 * component without any server-side dependencies.
 */
export function summarizeRows(rows: GenericFormattedRow[]): QaSummary {
  const canonicalMap = buildCanonicalMap(rows.map(r => r.team_name))
  let p1 = 0, p2 = 0, p3 = 0, excluded = 0, rejected = 0

  for (const row of rows) {
    const teamNameNormalized = canonicalMap.get(row.team_name) ?? row.team_name
    const result = classifyRow(
      {
        email:       row.email,
        phone:       row.phone,
        teamNameRaw: row.team_name,
        brokerage:   row.brokerage,
        website:     row.website,
      },
      teamNameNormalized,
    )
    switch (result.priority_tier) {
      case 'P1':       p1++;       break
      case 'P2':       p2++;       break
      case 'P3':       p3++;       break
      case 'Excluded': excluded++; break
      case 'Rejected': rejected++; break
    }
  }

  return { p1, p2, p3, excluded, rejected, total: rows.length }
}
