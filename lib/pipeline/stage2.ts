import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'
import type { EnrichRow } from '@/lib/supabase/types'

// ── URL cleaner ──────────────────────────────────────────
function cleanUrl(raw: string | null | undefined): string {
  if (!raw) return ''
  // Strip markdown link syntax [text](url)
  const mdMatch = raw.match(/\[.*?\]\((https?:\/\/[^)]+)\)/)
  if (mdMatch) return mdMatch[1]
  // Strip protocol and www for site: query
  return raw.trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .split('/')[0] // root domain only
    .split('?')[0]
    .toLowerCase()
}

// ── Serper search ────────────────────────────────────────
type SerperResult = { snippet: string; title: string; link: string }

async function serperSearch(query: string): Promise<SerperResult[]> {
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 5 }),
    })
    if (!res.ok) {
      console.error('[stage2] serper http error', res.status)
      return []
    }
    const data = await res.json()
    return (data.organic ?? []).map((r: Record<string, unknown>) => ({
      snippet: String(r.snippet ?? ''),
      title:   String(r.title   ?? ''),
      link:    String(r.link    ?? ''),
    }))
  } catch (e) {
    console.error('[stage2] serper error', e)
    return []
  }
}

// ── Regex team size extractor ────────────────────────────
function extractTeamSize(results: SerperResult[]): {
  team_size: number | null
  confidence: 'high' | 'medium' | 'low'
} {
  const patterns = [
    /team\s+of\s+(\d+)/gi,
    /(\d+)\s+(agent|realtor|member|associate|professional|advisor)s?/gi,
    /with\s+(\d+)\s+(agent|realtor|member|associate)s?/gi,
    /(\d+)[–\-](?:person|member|agent)\s+team/gi,
    /over\s+(\d+)\s+(agent|member|associate)s?/gi,
    /our\s+(\d+)\s+(agent|member|associate)s?/gi,
  ]

  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ')
  const candidates: number[] = []

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    const re = new RegExp(pattern.source, pattern.flags)
    while ((match = re.exec(allText)) !== null) {
      const num = parseInt(match[1], 10)
      if (num >= 1 && num <= 500) candidates.push(num)
    }
  }

  if (candidates.length === 0) return { team_size: null, confidence: 'low' }

  const freq: Record<number, number> = {}
  for (const n of candidates) freq[n] = (freq[n] ?? 0) + 1

  const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
  const teamSize = parseInt(best[0], 10)
  const count = best[1]

  const confidence = count >= 2 ? 'high' : candidates.length >= 1 ? 'medium' : 'low'
  return { team_size: teamSize, confidence }
}

// ── Build search query for a row ─────────────────────────
type QueryResult = { query: string; source: 'csv_website' | 'zillow_website' | 'company' }

const MEGA_BROKERAGE_DOMAINS = [
  'onereal.com', 'place.com', 'kwrealty.com', 'exprealty.com',
  'kw.com', 'coldwellbanker.com', 'century21.com', 'remax.com',
]

function buildQuery(row: EnrichRow): QueryResult {
  const profile     = (row.zillow_profile ?? {}) as Record<string, unknown>
  const csvDomain   = cleanUrl(row.website)
  const zillowDomain = cleanUrl(profile.website_url as string | null)
  const company     = (row.company ?? row.name ?? '').trim()
  const stateMatch  = (row.location ?? '').match(/,\s*([A-Z]{2})\s*$/)
  const state       = stateMatch?.[1] ?? ''

  if (csvDomain && !MEGA_BROKERAGE_DOMAINS.some(d => csvDomain.includes(d))) {
    return { query: `site:${csvDomain} team agents members`, source: 'csv_website' }
  }

  if (zillowDomain && !zillowDomain.includes('zillow.com')) {
    const rootDomain = zillowDomain.split('/')[0]
    return { query: `site:${rootDomain} team agents members`, source: 'zillow_website' }
  }

  return {
    query:  `"${company}" real estate team agents members ${state}`.trim(),
    source: 'company',
  }
}

// ── Group rows by domain to avoid duplicate Serper calls ─
function groupByDomain(rows: EnrichRow[]): Map<string, EnrichRow[]> {
  const groups = new Map<string, EnrichRow[]>()
  for (const row of rows) {
    const profile      = (row.zillow_profile ?? {}) as Record<string, unknown>
    const csvDomain    = cleanUrl(row.website)
    const zillowDomain = cleanUrl(profile.website_url as string | null)
    const key          = csvDomain || zillowDomain || `__no_website_${row.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  return groups
}

// ── Main Stage 2 ─────────────────────────────────────────
export async function runStage2(jobId: string): Promise<void> {
  console.log('[stage2] starting', jobId)

  const { error: startErr } = await supabaseAdmin
    .from('enrich_jobs')
    .update({ stage2_status: 'running' })
    .eq('id', jobId)
  if (startErr) {
    console.error('[stage2] failed to set running', startErr)
    throw startErr
  }

  try {
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .is('stage2_completed_at', null)
      .or('company.not.is.null,website.not.is.null')

    if (rowsErr) throw rowsErr

    if (!rows || rows.length === 0) {
      console.log('[stage2] no eligible rows')
      await supabaseAdmin.from('enrich_jobs').update({
        stage2_status:       'done',
        stage2_enriched:     0,
        stage2_completed_at: new Date().toISOString(),
      }).eq('id', jobId)
      return
    }

    const enrichable = rows as EnrichRow[]
    console.log(`[stage2] ${enrichable.length} rows, deduplicating by domain`)

    const groups = groupByDomain(enrichable)
    console.log(`[stage2] ${groups.size} unique domains to search`)

    let enrichedCount = 0
    const domainList  = Array.from(groups.entries())

    const BATCH = 5
    for (let i = 0; i < domainList.length; i += BATCH) {
      const batch = domainList.slice(i, i + BATCH)

      await Promise.all(batch.map(async ([domain, domainRows]) => {
        try {
          const { query, source } = buildQuery(domainRows[0])
          console.log(`[stage2] domain=${domain} source=${source} rows=${domainRows.length} query=${query}`)

          let results = await serperSearch(query)

          // Fallback: if site: query returns nothing, try company name search
          if (results.length === 0 && source !== 'company') {
            const company    = (domainRows[0].company ?? domainRows[0].name ?? '').trim()
            const stateMatch = (domainRows[0].location ?? '').match(/,\s*([A-Z]{2})\s*$/)
            const state      = stateMatch?.[1] ?? ''
            const fallback   = `"${company}" real estate team agents ${state}`.trim()
            console.log(`[stage2] fallback query: ${fallback}`)
            results = await serperSearch(fallback)
          }

          const { team_size, confidence } = extractTeamSize(results)
          console.log(`[stage2] domain=${domain} team_size=${team_size} confidence=${confidence}`)

          await Promise.all(domainRows.map(row =>
            supabaseAdmin.from('enrich_rows').update({
              stage2_team_size:            team_size,
              stage2_team_size_confidence: confidence,
              stage2_completed_at:         new Date().toISOString(),
            }).eq('id', row.id)
          ))
          enrichedCount += domainRows.length
        } catch (e) {
          console.error('[stage2] domain error', domain, e)
          await Promise.all(domainRows.map(row =>
            supabaseAdmin.from('enrich_rows').update({
              stage2_team_size:            null,
              stage2_team_size_confidence: 'low',
              stage2_completed_at:         new Date().toISOString(),
            }).eq('id', row.id)
          ))
          enrichedCount += domainRows.length
        }
      }))

      await supabaseAdmin.from('enrich_jobs').update({
        stage2_enriched: enrichedCount,
      }).eq('id', jobId)

      console.log(`[stage2] progress ${i + batch.length}/${domainList.length} domains done`)
    }

    await supabaseAdmin.from('enrich_jobs').update({
      stage2_status:       'done',
      stage2_enriched:     enrichedCount,
      stage2_completed_at: new Date().toISOString(),
    }).eq('id', jobId)

    console.log(`[stage2] complete job=${jobId} enriched=${enrichedCount} unique_domains=${groups.size}`)

  } catch (e) {
    console.error('[stage2] FATAL', e)
    await supabaseAdmin.from('enrich_jobs').update({ stage2_status: 'error' }).eq('id', jobId)
    throw e
  }
}
