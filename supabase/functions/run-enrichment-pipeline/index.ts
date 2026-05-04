import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ZILLOW_API_KEY = Deno.env.get('ZILLOW_ZIP_API_KEY') ?? ''

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
  enriched_data: Record<string, unknown> | null
  enrichment_status: 'pending' | 'found' | 'not_found'
  stage_reached: number | null
}

type StageResult = {
  row: EnrichRow
  found: boolean
  enrichedData: Record<string, unknown> | null
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

// ── Stage 1: real Zillow ZIP API ──────────────────────────────────────────────

const ZILLOW_ZIP_BASE = 'https://zillow-zip.up.railway.app'

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

async function enrichOneRow(row: EnrichRow, apiKey: string): Promise<StageResult> {
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
      }
    }
  }

  return { row, found: false, enrichedData: null }
}

async function runStage1Real(rows: EnrichRow[], apiKey: string): Promise<StageResult[]> {
  const results: StageResult[] = []
  const BATCH_SIZE = 5
  const DELAY_MS = 500

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(row => enrichOneRow(row, apiKey)))
    results.push(...batchResults)

    if (i + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  return results
}

async function runStage2Mock(rows: EnrichRow[]): Promise<StageResult[]> {
  const results: StageResult[] = []

  for (const row of rows) {
    await new Promise(r => setTimeout(r, 10))

    const found = Math.random() > 0.7
    const fi = row.formatted_input

    results.push({
      row,
      found,
      enrichedData: found ? {
        source: 'internal_db',
        stage: 2,
        full_name: fi?.name,
        email: fi?.email,
        phone: fi?.phone,
        team_name: fi?.team_name,
        fetched_at: new Date().toISOString(),
      } : null,
    })
  }

  return results
}

async function runStage3Mock(rows: EnrichRow[]): Promise<StageResult[]> {
  const results: StageResult[] = []

  for (const row of rows) {
    await new Promise(r => setTimeout(r, 10))

    const found = Math.random() > 0.6
    const fi = row.formatted_input

    results.push({
      row,
      found,
      enrichedData: found ? {
        source: 'scrape_endpoint',
        stage: 3,
        full_name: fi?.name,
        email: fi?.email,
        team_name: fi?.team_name,
        team_size: Math.floor(Math.random() * 50) + 1,
        fetched_at: new Date().toISOString(),
      } : null,
    })
  }

  return results
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(jobId: string) {
  try {
    const { data: allRows, error: rowsErr } = await supabase
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .order('row_index', { ascending: true })

    if (rowsErr) throw new Error(`Failed to fetch rows: ${rowsErr.message}`)

    const pendingRows = ((allRows ?? []) as EnrichRow[]).filter(r => r.enrichment_status === 'pending')

    if (pendingRows.length === 0) {
      await dbUpdateJob(jobId, { status: 'complete' })
      return
    }

    // Stage 1
    await dbUpdateJob(jobId, { status: 'stage1_running' })
    const stage1Results = await runStage1Real(pendingRows, ZILLOW_API_KEY)
    let stage1Found = 0

    for (const result of stage1Results) {
      if (result.found) {
        stage1Found++
        await dbUpdateRow(result.row.id, {
          enrichment_status: 'found',
          stage_reached: 1,
          enriched_data: result.enrichedData,
        })
      } else {
        await dbUpdateRow(result.row.id, { enrichment_status: 'not_found', stage_reached: 1 })
      }
    }

    await dbUpdateJob(jobId, {
      stage1_completed_at: new Date().toISOString(),
      stage1_found_count: stage1Found,
    })

    const stage2Rows = stage1Results.filter(r => !r.found).map(r => r.row)
    if (stage2Rows.length === 0) {
      await dbUpdateJob(jobId, { status: 'complete' })
      return
    }

    // Stage 2
    await dbUpdateJob(jobId, { status: 'stage2_running' })
    const stage2Results = await runStage2Mock(stage2Rows)
    let stage2Found = 0

    for (const result of stage2Results) {
      if (result.found) {
        stage2Found++
        await dbUpdateRow(result.row.id, {
          enrichment_status: 'found',
          stage_reached: 2,
          enriched_data: result.enrichedData,
        })
      } else {
        await dbUpdateRow(result.row.id, { enrichment_status: 'not_found', stage_reached: 2 })
      }
    }

    await dbUpdateJob(jobId, {
      stage2_completed_at: new Date().toISOString(),
      stage2_found_count: stage2Found,
    })

    const stage3Rows = stage2Results.filter(r => !r.found).map(r => r.row)
    if (stage3Rows.length === 0) {
      await dbUpdateJob(jobId, { status: 'complete' })
      return
    }

    // Stage 3
    await dbUpdateJob(jobId, { status: 'stage3_running' })
    const stage3Results = await runStage3Mock(stage3Rows)
    let stage3Found = 0

    for (const result of stage3Results) {
      if (result.found) {
        stage3Found++
        await dbUpdateRow(result.row.id, {
          enrichment_status: 'found',
          stage_reached: 3,
          enriched_data: result.enrichedData,
        })
      } else {
        await dbUpdateRow(result.row.id, { enrichment_status: 'not_found', stage_reached: 3 })
      }
    }

    await dbUpdateJob(jobId, {
      stage3_completed_at: new Date().toISOString(),
      stage3_found_count: stage3Found,
    })

    await dbUpdateJob(jobId, { status: 'complete' })
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
      return new Response(
        JSON.stringify({ error: 'Missing jobId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const { data: job, error: jobErr } = await supabase
    .from('enrich_jobs')
    .select('id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr || !job) {
    return new Response(
      JSON.stringify({ error: 'Job not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (job.status !== 'ready' && job.status !== 'stage1_running') {
    return new Response(
      JSON.stringify({ error: `Job is not ready (current status: ${job.status})` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  await runPipeline(jobId)

  return new Response(
    JSON.stringify({ success: true, jobId }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
