import type { EnrichRow } from '../supabase/types'
import { env } from '../env'

const ZILLOW_ZIP_BASE = 'https://zillow-zip.up.railway.app'

export type Stage1Result = {
  row: EnrichRow
  found: boolean
  enrichedData: Record<string, unknown> | null
  matchedOn: 'email' | 'phone' | null
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

async function searchZillow(
  params: URLSearchParams,
  endpoint: string,
  apiKey: string
): Promise<{ results: Record<string, unknown>[]; total: number } | null> {
  try {
    const res = await fetch(`${ZILLOW_ZIP_BASE}${endpoint}?${params}`, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return await res.json() as { results: Record<string, unknown>[]; total: number }
  } catch {
    return null
  }
}

async function enrichOneRow(row: EnrichRow, apiKey: string): Promise<Stage1Result> {
  const fi = row.formatted_input
  const email = fi?.email ?? ''
  const phone = normalizePhone(fi?.phone ?? '')

  if (email) {
    const params = new URLSearchParams({ email, exact: 'true', limit: '1' })
    const data = await searchZillow(params, '/api/agents/by-email', apiKey)
    if (data && data.total > 0) {
      return {
        row,
        found: true,
        enrichedData: {
          ...data.results[0],
          source: 'zillow_zip',
          stage: 1,
          matched_on: 'email',
          fetched_at: new Date().toISOString(),
        },
        matchedOn: 'email',
      }
    }
  }

  if (phone) {
    const params = new URLSearchParams({ phone, limit: '1' })
    const data = await searchZillow(params, '/api/agents/by-phone', apiKey)
    if (data && data.total > 0) {
      return {
        row,
        found: true,
        enrichedData: {
          ...data.results[0],
          source: 'zillow_zip',
          stage: 1,
          matched_on: 'phone',
          fetched_at: new Date().toISOString(),
        },
        matchedOn: 'phone',
      }
    }
  }

  return { row, found: false, enrichedData: null, matchedOn: null }
}

async function processBatch(
  rows: EnrichRow[],
  apiKey: string,
  batchSize = 5,
  delayMs = 500
): Promise<Stage1Result[]> {
  const results: Stage1Result[] = []

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(row => enrichOneRow(row, apiKey)))
    results.push(...batchResults)

    if (i + batchSize < rows.length) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }

  return results
}

export async function runStage1(rows: EnrichRow[]): Promise<Stage1Result[]> {
  return processBatch(rows, env.ZILLOW_ZIP_API_KEY, 5, 500)
}
