import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ZILLOW_API_KEY = Deno.env.get('ZILLOW_ZIP_API_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''

const ZILLOW_ZIP_BASE = 'https://zillow-zip.up.railway.app'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── Inline types ──────────────────────────────────────────────────────────────

type GenericFormattedRow = {
  name: string; email: string; phone: string; team_name: string;
  brokerage: string; website: string; location: string; hs_ticket_url: string;
}

type EnrichRow = {
  id: string
  job_id: string
  row_index: number
  hs_ticket_url: string
  raw_data: Record<string, string>
  formatted_input: GenericFormattedRow | null
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function dbUpdateRow(id: string, fields: Record<string, unknown>) {
  const { error } = await supabase.from('enrich_rows').update(fields).eq('id', id)
  if (error) throw new Error(`Failed to update row ${id}: ${error.message}`)
}

async function dbUpdateJob(id: string, fields: Record<string, unknown>) {
  const { error } = await supabase.from('enrich_jobs').update(fields).eq('id', id)
  if (error) throw new Error(`Failed to update job ${id}: ${error.message}`)
}

// ── Branch 2: Contact via Zillow ZIP + mad.agents ────────────────────────────

type ContactResult = {
  rowId: string
  found: boolean
  source: 'zillow_zip' | 'mad_agents' | null
  data: Record<string, unknown> | null
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

async function searchZillow(
  params: URLSearchParams,
  endpoint: string
): Promise<{ results: Record<string, unknown>[]; total: number } | null> {
  try {
    const res = await fetch(`${ZILLOW_ZIP_BASE}${endpoint}?${params}`, {
      headers: { 'X-API-Key': ZILLOW_API_KEY },
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
        rowId: row.id, found: true, source: 'zillow_zip',
        data: { ...data.results[0], source: 'zillow_zip', matched_on: 'email', fetched_at: new Date().toISOString() },
      }
    }
  }

  if (phone) {
    const params = new URLSearchParams({ phone, limit: '1' })
    const data = await searchZillow(params, '/api/agents/by-phone')
    if (data && data.total > 0) {
      return {
        rowId: row.id, found: true, source: 'zillow_zip',
        data: { ...data.results[0], source: 'zillow_zip', matched_on: 'phone', fetched_at: new Date().toISOString() },
      }
    }
  }

  return null
}

async function lookupMadAgents(row: EnrichRow): Promise<ContactResult | null> {
  const fi = row.formatted_input
  const email = fi?.email ?? ''
  const phone = normalizePhone(fi?.phone ?? '')

  if (email) {
    const { data, error } = await supabase.schema('mad').from('agents').select('*').ilike('email', email).limit(1)
    if (!error && data && data.length > 0) {
      return {
        rowId: row.id, found: true, source: 'mad_agents',
        data: { ...data[0], source: 'mad_agents', matched_on: 'email', fetched_at: new Date().toISOString() },
      }
    }
  }

  if (phone) {
    const last10 = phone.slice(-10)
    if (last10.length >= 10) {
      const { data: allPhones, error: phoneErr } = await supabase
        .schema('mad')
        .from('agents')
        .select('*')
        .not('phone', 'is', null)
        .limit(1000)

      if (!phoneErr && allPhones) {
        const match = allPhones.find((a: Record<string, unknown>) => {
          const normalized = ((a.phone as string) ?? '').replace(/\D/g, '')
          return normalized.slice(-10) === last10
        })
        if (match) {
          return {
            rowId: row.id, found: true, source: 'mad_agents',
            data: { ...match, source: 'mad_agents', matched_on: 'phone', fetched_at: new Date().toISOString() },
          }
        }
      }
    }
  }

  return null
}

async function enrichContactRow(row: EnrichRow): Promise<ContactResult> {
  const zillowResult = await lookupZillow(row)
  if (zillowResult) return zillowResult
  const madResult = await lookupMadAgents(row)
  if (madResult) return madResult
  return { rowId: row.id, found: false, source: null, data: null }
}

async function runBranch2(rows: EnrichRow[]): Promise<ContactResult[]> {
  const BATCH_SIZE = 5
  const DELAY_MS = 500
  const results: ContactResult[] = []

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(enrichContactRow))
    results.push(...batchResults)
    if (i + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  return results
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(jobId: string) {
  try {
    const { data: allRowsData, error: rowsErr } = await supabase
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .order('row_index', { ascending: true })

    if (rowsErr) throw new Error(`Failed to fetch rows: ${rowsErr.message}`)

    const allRows = (allRowsData ?? []) as EnrichRow[]

    if (allRows.length === 0) {
      await dbUpdateJob(jobId, { status: 'complete' })
      return
    }

    await dbUpdateJob(jobId, {
      status: 'both_running',
      branch1_status: 'running',
      branch2_status: 'running',
    })

    // Fire Branch 1 (team size) as non-blocking — runs on Railway, no Edge Function timeout
    if (APP_URL) {
      fetch(`${APP_URL}/api/enrich/team-size-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(err => console.error('Branch 1 fire failed:', err))
    }

    // Branch 2: Zillow ZIP + mad.agents — runs here in Edge Function
    const branch2Results = await runBranch2(allRows)

    let branch2FoundCount = 0
    for (const result of branch2Results) {
      if (result.found) branch2FoundCount++
      await dbUpdateRow(result.rowId, {
        contact_data: result.data,
        branch2_status: result.found ? 'found' : 'not_found',
      })
    }

    await dbUpdateJob(jobId, {
      branch2_status: 'complete',
      branch2_completed_at: new Date().toISOString(),
      branch2_found_count: branch2FoundCount,
    })

    // Delegate completion check to avoid race condition with Branch 1
    if (APP_URL) {
      fetch(`${APP_URL}/api/enrich/check-completion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(err => console.error('check-completion failed:', err))
    }

  } catch (e) {
    await dbUpdateJob(jobId, {
      status: 'failed',
      error_log: e instanceof Error ? e.message : 'Unknown pipeline error',
    })
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let jobId: string
  try {
    const body = await req.json()
    jobId = body.jobId
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'Missing jobId' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { data: job, error: jobErr } = await supabase
    .from('enrich_jobs')
    .select('id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr || !job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  const allowedStatuses = ['ready', 'stage1_running', 'both_running']
  if (!allowedStatuses.includes(job.status)) {
    return new Response(
      JSON.stringify({ error: `Job cannot be run (current status: ${job.status})` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  await runPipeline(jobId)

  return new Response(JSON.stringify({ success: true, jobId }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
