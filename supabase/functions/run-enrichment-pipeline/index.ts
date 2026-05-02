import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

// ── Stage mocks ───────────────────────────────────────────────────────────────

const PERSONAL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'])

async function runStage1Mock(rows: EnrichRow[]): Promise<StageResult[]> {
  const results: StageResult[] = []

  for (const row of rows) {
    await new Promise(r => setTimeout(r, 10))

    const fi = row.formatted_input
    const email = fi?.email ?? ''
    const name = fi?.name ?? ''

    const domain = email.split('@')[1] ?? ''
    const hasRealDomain = domain.length > 0 && !PERSONAL_DOMAINS.has(domain)
    const hasMultipleWords = name.trim().split(/\s+/).filter(Boolean).length > 1

    let found = false
    let matchedOn: string | null = null

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
    })
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
    const stage1Results = await runStage1Mock(pendingRows)
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
