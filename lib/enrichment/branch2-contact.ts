import type { EnrichRow } from '../supabase/types'
import { env } from '../env'
import { supabaseAdmin } from '../supabase/client'

const ZILLOW_ZIP_BASE = 'https://zillow-zip.up.railway.app'

export type ContactResult = {
  row: EnrichRow
  found: boolean
  source: 'zillow_zip' | 'mad_agents' | null
  data: Record<string, unknown> | null
}

// ── Zillow ZIP ────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

async function searchZillow(
  params: URLSearchParams,
  endpoint: string
): Promise<{ results: Record<string, unknown>[]; total: number } | null> {
  try {
    const res = await fetch(`${ZILLOW_ZIP_BASE}${endpoint}?${params}`, {
      headers: { 'X-API-Key': env.ZILLOW_ZIP_API_KEY },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return await res.json() as { results: Record<string, unknown>[]; total: number }
  } catch {
    return null
  }
}

async function lookupZillow(row: EnrichRow): Promise<ContactResult | null> {
  const fi = row.formatted_input
  const email = fi?.email ?? ''
  const phone = normalizePhone(fi?.phone ?? '')

  if (email) {
    const params = new URLSearchParams({ email, exact: 'true', limit: '1' })
    const data = await searchZillow(params, '/api/agents/by-email')
    if (data && data.total > 0) {
      return {
        row,
        found: true,
        source: 'zillow_zip',
        data: {
          ...data.results[0],
          source: 'zillow_zip',
          matched_on: 'email',
          fetched_at: new Date().toISOString(),
        },
      }
    }
  }

  if (phone) {
    const params = new URLSearchParams({ phone, limit: '1' })
    const data = await searchZillow(params, '/api/agents/by-phone')
    if (data && data.total > 0) {
      return {
        row,
        found: true,
        source: 'zillow_zip',
        data: {
          ...data.results[0],
          source: 'zillow_zip',
          matched_on: 'phone',
          fetched_at: new Date().toISOString(),
        },
      }
    }
  }

  return null
}

// ── mad.agents ────────────────────────────────────────────────────────────────

async function lookupMadAgents(row: EnrichRow): Promise<ContactResult | null> {
  const fi = row.formatted_input
  const email = fi?.email ?? ''
  const phone = normalizePhone(fi?.phone ?? '')

  if (email) {
    const { data, error } = await supabaseAdmin.schema('mad').from('agents').select('*').eq('email', email).limit(1)
    if (!error && data && data.length > 0) {
      return {
        row,
        found: true,
        source: 'mad_agents',
        data: {
          ...(data[0] as Record<string, unknown>),
          source: 'mad_agents',
          matched_on: 'email',
          fetched_at: new Date().toISOString(),
        },
      }
    }
  }

  if (phone) {
    const { data, error } = await supabaseAdmin.schema('mad').from('agents').select('*').eq('phone', phone).limit(1)
    if (!error && data && data.length > 0) {
      return {
        row,
        found: true,
        source: 'mad_agents',
        data: {
          ...(data[0] as Record<string, unknown>),
          source: 'mad_agents',
          matched_on: 'phone',
          fetched_at: new Date().toISOString(),
        },
      }
    }
  }

  return null
}

// ── Orchestration ─────────────────────────────────────────────────────────────

async function enrichOneRow(row: EnrichRow): Promise<ContactResult> {
  const zillowResult = await lookupZillow(row)
  if (zillowResult) return zillowResult

  const madResult = await lookupMadAgents(row)
  if (madResult) return madResult

  return { row, found: false, source: null, data: null }
}

export async function runBranch2(rows: EnrichRow[]): Promise<ContactResult[]> {
  const BATCH_SIZE = 5
  const DELAY_MS = 500
  const results: ContactResult[] = []

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(enrichOneRow))
    results.push(...batchResults)
    if (i + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  return results
}
