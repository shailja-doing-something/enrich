import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ZILLOW_API_KEY = Deno.env.get('ZILLOW_ZIP_API_KEY') ?? ''

const WEBHOOK_URL = 'https://fello-ai.app.n8n.cloud/webhook/scrappy2'
const STATUS_BASE = 'https://team-size-webhook-production.up.railway.app/api/v1/enrich/tasks'
const ZILLOW_ZIP_BASE = 'https://zillow-zip.up.railway.app'

// Reduced for 150s Edge Function timeout (~100s max per row for Branch 1)
const BRANCH1_MAX_POLLS = 20
const POLL_INTERVAL_MS = 5000

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

// ── Branch 1: Team Size via n8n webhook + polling ────────────────────────────

type TeamSizeResult = {
  rowId: string
  found: boolean
  taskId: string | null
  data: Record<string, unknown> | null
}

async function enrichTeamSizeRow(row: EnrichRow): Promise<TeamSizeResult> {
  const fi = row.formatted_input
  if (!fi) return { rowId: row.id, found: false, taskId: null, data: null }

  const nameParts = (fi.name ?? '').trim().split(/\s+/)
  const firstName = nameParts[0] ?? ''
  const lastName = nameParts.slice(1).join(' ')

  let taskId: string | null = null
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: fi.email,
        phone: fi.phone,
        company: fi.team_name || fi.brokerage,
        website: fi.website,
        firstname: firstName,
        lastname: lastName,
        team_name: fi.team_name,
        hs_object_id: row.hs_ticket_url,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { rowId: row.id, found: false, taskId: null, data: null }
    const json = await res.json() as Record<string, unknown>
    taskId = (json.task_id ?? json.taskId ?? null) as string | null
  } catch {
    return { rowId: row.id, found: false, taskId: null, data: null }
  }

  if (!taskId) return { rowId: row.id, found: false, taskId: null, data: null }

  for (let i = 0; i < BRANCH1_MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    try {
      const res = await fetch(`${STATUS_BASE}/${taskId}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const json = await res.json() as Record<string, unknown>
      if (json.ready === true && json.status === 'success') {
        const result = json.result as Record<string, unknown>
        return {
          rowId: row.id,
          found: true,
          taskId,
          data: {
            source: 'team_size_webhook',
            task_id: taskId,
            fetched_at: new Date().toISOString(),
            team_size_count: result.team_size_count,
            team_size_category: result.team_size_category,
            team_name: result.team_name,
            brokerage_name: result.brokerage_name,
            homepage_url: result.homepage_url,
            team_page_url: result.team_page_url,
            confidence: result.confidence,
            reasoning: result.reasoning,
            agent_id: result.agent_id,
            agent_designation: result.agent_designation,
            detected_crms: result.detected_crms,
            team_members: result.team_members,
          },
        }
      }
    } catch {
      // transient — keep polling
    }
  }

  return { rowId: row.id, found: false, taskId, data: null }
}

async function runBranch1(rows: EnrichRow[]): Promise<TeamSizeResult[]> {
  const results: TeamSizeResult[] = []
  for (const row of rows) {
    results.push(await enrichTeamSizeRow(row))
  }
  return results
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
    const { data, error } = await supabase.schema('mad').from('agents').select('*').eq('email', email).limit(1)
    if (!error && data && data.length > 0) {
      return {
        rowId: row.id, found: true, source: 'mad_agents',
        data: { ...data[0], source: 'mad_agents', matched_on: 'email', fetched_at: new Date().toISOString() },
      }
    }
  }

  if (phone) {
    const { data, error } = await supabase.schema('mad').from('agents').select('*').eq('phone', phone).limit(1)
    if (!error && data && data.length > 0) {
      return {
        rowId: row.id, found: true, source: 'mad_agents',
        data: { ...data[0], source: 'mad_agents', matched_on: 'phone', fetched_at: new Date().toISOString() },
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

    const [branch1Results, branch2Results] = await Promise.all([
      runBranch1(allRows),
      runBranch2(allRows),
    ])

    // Write Branch 1 results
    let branch1FoundCount = 0
    for (const result of branch1Results) {
      if (result.found) branch1FoundCount++
      await dbUpdateRow(result.rowId, {
        team_size_data: result.data,
        branch1_status: result.found ? 'found' : 'not_found',
      })
    }

    // Write Branch 2 results
    let branch2FoundCount = 0
    for (const result of branch2Results) {
      if (result.found) branch2FoundCount++
      await dbUpdateRow(result.rowId, {
        contact_data: result.data,
        branch2_status: result.found ? 'found' : 'not_found',
      })
    }

    await dbUpdateJob(jobId, {
      branch1_status: 'complete',
      branch2_status: 'complete',
      branch1_completed_at: new Date().toISOString(),
      branch2_completed_at: new Date().toISOString(),
      branch1_found_count: branch1FoundCount,
      branch2_found_count: branch2FoundCount,
      status: 'merging',
    })

    // Merge
    const branch1Map = new Map(branch1Results.map(r => [r.rowId, r.data]))
    const branch2Map = new Map(branch2Results.map(r => [r.rowId, r.data]))

    for (const row of allRows) {
      const teamData = branch1Map.get(row.id) ?? null
      const contactData = branch2Map.get(row.id) ?? null
      const fi = row.formatted_input

      await dbUpdateRow(row.id, {
        merged_data: {
          name: fi?.name ?? null,
          email: fi?.email ?? null,
          phone: fi?.phone ?? null,
          location: fi?.location ?? null,
          hs_ticket_url: row.hs_ticket_url,
          team_size_count: teamData?.team_size_count ?? null,
          team_size_category: teamData?.team_size_category ?? null,
          team_name_enriched: teamData?.team_name ?? null,
          brokerage_enriched: teamData?.brokerage_name ?? null,
          team_page_url: teamData?.team_page_url ?? null,
          homepage_url: teamData?.homepage_url ?? null,
          confidence: teamData?.confidence ?? null,
          team_members: teamData?.team_members ?? null,
          zillow_profile: contactData?.profile_link ?? null,
          zillow_rating: contactData?.rating_average ?? null,
          zillow_reviews: contactData?.rating_count ?? null,
          zillow_sales_12m: contactData?.sales_last_12_months ?? null,
          zillow_sales_total: contactData?.sales_total ?? null,
          zillow_is_top_agent: contactData?.is_top_agent ?? null,
          zillow_is_team: contactData?.is_team ?? null,
          contact_source: contactData?.source ?? null,
          enriched_at: new Date().toISOString(),
          branch1_found: !!teamData,
          branch2_found: !!contactData,
        },
      })
    }

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
