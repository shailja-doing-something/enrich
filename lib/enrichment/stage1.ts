import type { EnrichRow } from '../supabase/types'
import { env } from '../env'

export type Stage1Result = {
  row: EnrichRow
  found: boolean
  enrichedData: Record<string, unknown> | null
  matchedOn: 'name' | 'email' | 'both' | null
}

const PERSONAL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'])

export async function runStage1Mock(rows: EnrichRow[]): Promise<Stage1Result[]> {
  const results: Stage1Result[] = []

  for (const row of rows) {
    await new Promise(r => setTimeout(r, 10))

    const fi = row.formatted_input
    const email = fi?.email ?? ''
    const name = fi?.name ?? ''

    const domain = email.split('@')[1] ?? ''
    const hasRealDomain = domain.length > 0 && !PERSONAL_DOMAINS.has(domain)
    const hasMultipleWords = name.trim().split(/\s+/).filter(Boolean).length > 1

    let found = false
    let matchedOn: Stage1Result['matchedOn'] = null

    if (hasRealDomain) {
      found = true
      matchedOn = hasMultipleWords ? 'both' : 'email'
    } else if (hasMultipleWords && Math.random() > 0.5) {
      found = true
      matchedOn = 'name'
    }

    results.push({
      row,
      found,
      enrichedData: found ? {
        source: 'zillow_zip',
        stage: 1,
        profile_link: 'https://www.zillow.com/profile/mock',
        full_name: fi?.name,
        email: fi?.email,
        phone_cell: fi?.phone,
        business_name: fi?.brokerage || fi?.team_name,
        address_city: fi?.location,
        matched_on: matchedOn,
        fetched_at: new Date().toISOString(),
      } : null,
      matchedOn,
    })
  }

  return results
}

export async function runStage1Real(rows: EnrichRow[]): Promise<Stage1Result[]> {
  const results: Stage1Result[] = []

  for (const row of rows) {
    const fi = row.formatted_input
    const name = fi?.name ?? ''
    const email = fi?.email ?? ''

    const params = new URLSearchParams({ name, email })
    const res = await fetch(
      `https://zillow-zip.up.railway.app/api/search?${params}`,
      { headers: { 'x-internal-api-key': env.ZILLOW_ZIP_API_KEY } }
    )

    if (!res.ok) {
      results.push({ row, found: false, enrichedData: null, matchedOn: null })
      continue
    }

    const json = await res.json() as { results: Record<string, unknown>[]; total: number }

    if (json.total === 0) {
      results.push({ row, found: false, enrichedData: null, matchedOn: null })
    } else {
      results.push({
        row,
        found: true,
        enrichedData: {
          ...json.results[0],
          source: 'zillow_zip',
          stage: 1,
          fetched_at: new Date().toISOString(),
        },
        matchedOn: null,
      })
    }
  }

  return results
}

// swap to runStage1Real when API key is ready
export function runStage1(rows: EnrichRow[]): Promise<Stage1Result[]> {
  return runStage1Mock(rows)
}
