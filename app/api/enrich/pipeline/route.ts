import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/client'
import { updateJob } from '@/lib/supabase/jobs'
// Removed — pending new pipeline integration
// import { prioritizeRows } from '@/lib/enrichment/contactPrioritizer'
// import type { EnrichRow as TypedRow } from '@/lib/supabase/types'

const ZILLOW_ZIP_BASE = 'https://zillow-zip.up.railway.app'
const ASYNC_URL = 'https://team-size-webhook-production.up.railway.app/api/v1/enrich/async'
const STATUS_BASE = 'https://team-size-webhook-production.up.railway.app/api/v1/enrich/tasks'

export const maxDuration = 300 // 5 minutes max on Railway

export async function POST(request: NextRequest) {
  let jobId: string
  try {
    const body = await request.json()
    jobId = body.jobId
    if (!jobId) return Response.json(
      { error: 'Missing jobId' }, { status: 400 }
    )
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Return 200 immediately — work happens async
  runPipeline(jobId).catch(err =>
    console.error('[Pipeline] Fatal:', err)
  )

  return Response.json({ started: true, jobId })
}

async function runPipeline(jobId: string) {
  try {
    console.log('[Pipeline] Starting for job:', jobId)

    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .order('row_index', { ascending: true })

    if (rowsErr) throw new Error(rowsErr.message)
    if (!rows || rows.length === 0) {
      await updateJob(jobId, { status: 'complete' })
      return
    }

    console.log('[Pipeline] Processing', rows.length, 'rows')

    // Removed — pending new pipeline integration
    // QA prioritization (prioritizeRows) and the DB write of QA fields were here.
    // They are disabled because the pipeline no longer runs from this route.
    // The contactPrioritizer.ts file is kept intact; only this call is disabled.

    const enrichableRows = rows as EnrichRow[]

    await updateJob(jobId, {
      status: 'both_running',
      branch1_status: 'running',
      branch2_status: 'running',
    })

    // Run both branches in parallel against enrichable rows only
    const [b1Count, b2Count] = await Promise.all([
      runBranch1(jobId, enrichableRows),
      runBranch2(jobId, enrichableRows),
    ])

    console.log('[Pipeline] Both complete. B1:', b1Count, 'B2:', b2Count)

    await mergeResults(jobId)

    await updateJob(jobId, { status: 'complete' })
    console.log('[Pipeline] Done for job:', jobId)

  } catch (e) {
    console.error('[Pipeline] Error:', e)
    await updateJob(jobId, {
      status: 'failed',
      error_log: e instanceof Error ? e.message : String(e),
    })
  }
}

// ── Branch 1: Team Size ──────────────────────────────

type EnrichRow = Record<string, unknown>
type Submission = { rowId: string; taskId: string | null }

async function runBranch1(jobId: string, rows: EnrichRow[]): Promise<number> {
  console.log('[Branch1] Submitting', rows.length, 'rows')

  const submissions: Submission[] = await Promise.all(rows.map(async (row) => {
    const fi = row.formatted_input as Record<string, string> | null
    const nameParts = (fi?.name ?? '').trim().split(/\s+/)
    const firstName = nameParts[0] ?? ''
    const lastName = nameParts.slice(1).join(' ')
    const rowId = row.id as string

    try {
      const res = await fetch(`${ASYNC_URL}?priority=false`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          list_name: `${firstName} ${lastName}`.trim(),
          list_email: fi?.email ?? '',
          list_phone: String(fi?.phone ?? ''),
          list_team_name: fi?.team_name || fi?.brokerage || '',
          list_website: fi?.website || '',
          list_location: 'na',
        }),
        signal: AbortSignal.timeout(30000),
      })

      if (!res.ok) {
        console.error('[Branch1] Submit failed:', fi?.email, res.status)
        return { rowId, taskId: null }
      }

      const json = await res.json() as Record<string, unknown>
      const taskId = (json.task_id ?? json.taskId ?? json.id ?? null) as string | null
      console.log('[Branch1] Submitted:', fi?.email, '→ task:', taskId)

      if (taskId) {
        await supabaseAdmin
          .from('enrich_rows')
          .update({ team_size_task_id: taskId, branch1_status: 'running' })
          .eq('id', rowId)
      }

      return { rowId, taskId }
    } catch (e) {
      console.error('[Branch1] Submit error:', fi?.email, String(e))
      return { rowId, taskId: null }
    }
  }))

  const withTask = submissions.filter(s => s.taskId)
  const withoutTask = submissions.filter(s => !s.taskId)

  for (const s of withoutTask) {
    await supabaseAdmin
      .from('enrich_rows')
      .update({ branch1_status: 'not_found' })
      .eq('id', s.rowId)
  }

  console.log('[Branch1] Submitted:', withTask.length,
    'No taskId:', withoutTask.length)

  const MAX_POLLS = 40
  const POLL_INTERVAL = 5000
  const completed = new Set<string>()
  let foundCount = 0
  let polls = 0

  while (completed.size < withTask.length && polls < MAX_POLLS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    polls++

    const pending = withTask.filter(s => !completed.has(s.rowId))

    await Promise.all(pending.map(async (s) => {
      try {
        const res = await fetch(`${STATUS_BASE}/${s.taskId}`, {
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) return

        const data = await res.json() as Record<string, unknown>

        if (data.ready === true && data.status === 'success') {
          completed.add(s.rowId)
          const result = data.result as Record<string, unknown>

          await supabaseAdmin
            .from('enrich_rows')
            .update({
              team_size_data: {
                source: 'team_size_webhook',
                task_id: s.taskId,
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
                team_members: result.team_members,
                detected_crms: result.detected_crms,
              },
              branch1_status: 'found',
            })
            .eq('id', s.rowId)

          foundCount++
          console.log('[Branch1] Found:', s.rowId, 'total:', foundCount)

        } else if (data.status === 'failed' || data.error_code) {
          completed.add(s.rowId)
          await supabaseAdmin
            .from('enrich_rows')
            .update({ branch1_status: 'not_found' })
            .eq('id', s.rowId)
        }
      } catch (e) {
        console.error('[Branch1] Poll error:', s.rowId, String(e))
      }
    }))

    console.log('[Branch1] Poll', polls,
      'completed:', completed.size, '/', withTask.length)
  }

  const timedOut = withTask.filter(s => !completed.has(s.rowId))
  for (const s of timedOut) {
    await supabaseAdmin
      .from('enrich_rows')
      .update({ branch1_status: 'not_found' })
      .eq('id', s.rowId)
  }

  await updateJob(jobId, {
    branch1_status: 'complete',
    branch1_completed_at: new Date().toISOString(),
    branch1_found_count: foundCount,
  })

  console.log('[Branch1] Complete. Found:', foundCount)
  return foundCount
}

// ── Branch 2: Contact Enrichment ─────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

async function lookupZillow(row: EnrichRow): Promise<Record<string, unknown> | null> {
  const fi = row.formatted_input as Record<string, string> | null
  const email = fi?.email ?? ''
  const phone = normalizePhone(fi?.phone ?? '')
  const apiKey = process.env.ZILLOW_ZIP_API_KEY ?? ''

  if (email) {
    try {
      const res = await fetch(
        `${ZILLOW_ZIP_BASE}/api/agents/by-email?email=${encodeURIComponent(email)}&exact=true&limit=1`,
        { headers: { 'X-API-Key': apiKey }, signal: AbortSignal.timeout(15000) }
      )
      if (res.ok) {
        const data = await res.json() as { total: number; results: Record<string, unknown>[] }
        if (data.total > 0) {
          return { ...data.results[0], source: 'zillow_zip', matched_on: 'email', fetched_at: new Date().toISOString() }
        }
      }
    } catch {}
  }

  if (phone && phone.length >= 10) {
    try {
      const res = await fetch(
        `${ZILLOW_ZIP_BASE}/api/agents/by-phone?phone=${encodeURIComponent(phone)}&limit=1`,
        { headers: { 'X-API-Key': apiKey }, signal: AbortSignal.timeout(15000) }
      )
      if (res.ok) {
        const data = await res.json() as { total: number; results: Record<string, unknown>[] }
        if (data.total > 0) {
          return { ...data.results[0], source: 'zillow_zip', matched_on: 'phone', fetched_at: new Date().toISOString() }
        }
      }
    } catch {}
  }

  return null
}

async function lookupMadAgents(row: EnrichRow): Promise<Record<string, unknown> | null> {
  const fi = row.formatted_input as Record<string, string> | null
  const email = (fi?.email ?? '').toLowerCase().trim()
  const phone = normalizePhone(fi?.phone ?? '')

  if (email) {
    const { data, error } = await supabaseAdmin
      .schema('mad')
      .from('agents')
      .select('*')
      .ilike('email', email)
      .limit(1)
      .maybeSingle()

    if (!error && data) {
      return { ...(data as Record<string, unknown>), source: 'mad_agents', matched_on: 'email', fetched_at: new Date().toISOString() }
    }
  }

  if (phone && phone.length >= 10) {
    const last10 = phone.slice(-10)
    const { data: allPhones } = await supabaseAdmin
      .schema('mad')
      .from('agents')
      .select('*')
      .not('phone', 'is', null)
      .limit(1000)

    if (allPhones) {
      const match = (allPhones as Record<string, unknown>[]).find(a => {
        const p = normalizePhone(String(a.phone ?? ''))
        return p.slice(-10) === last10
      })
      if (match) {
        return { ...match, source: 'mad_agents', matched_on: 'phone', fetched_at: new Date().toISOString() }
      }
    }
  }

  return null
}

async function runBranch2(jobId: string, rows: EnrichRow[]): Promise<number> {
  console.log('[Branch2] Processing', rows.length, 'rows')
  let foundCount = 0
  const BATCH_SIZE = 5
  const DELAY_MS = 500

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async (row) => {
      const rowId = row.id as string
      try {
        let contactData = await lookupZillow(row)
        if (!contactData) contactData = await lookupMadAgents(row)

        await supabaseAdmin
          .from('enrich_rows')
          .update({
            contact_data: contactData,
            branch2_status: contactData ? 'found' : 'not_found',
          })
          .eq('id', rowId)

        if (contactData) foundCount++
      } catch (e) {
        console.error('[Branch2] Row error:', rowId, String(e))
        await supabaseAdmin
          .from('enrich_rows')
          .update({ branch2_status: 'not_found' })
          .eq('id', rowId)
      }
    }))

    if (i + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }

    if (i % 50 === 0) {
      console.log('[Branch2] Progress:', i, '/', rows.length, 'found:', foundCount)
    }
  }

  await updateJob(jobId, {
    branch2_status: 'complete',
    branch2_completed_at: new Date().toISOString(),
    branch2_found_count: foundCount,
  })

  console.log('[Branch2] Complete. Found:', foundCount)
  return foundCount
}

// ── Merge ─────────────────────────────────────────────

async function mergeResults(jobId: string) {
  console.log('[Merge] Merging rows for job:', jobId)

  const { data: freshRows } = await supabaseAdmin
    .from('enrich_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('row_index', { ascending: true })

  if (!freshRows) return

  await updateJob(jobId, { status: 'merging' })

  const BATCH_SIZE = 50
  for (let i = 0; i < freshRows.length; i += BATCH_SIZE) {
    const batch = freshRows.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async (row: EnrichRow) => {
      const teamData = row.team_size_data as Record<string, unknown> | null
      const contactData = row.contact_data as Record<string, unknown> | null
      const fi = row.formatted_input as Record<string, unknown> | null

      const merged = {
        name: fi?.name ?? null,
        email: fi?.email ?? null,
        phone: fi?.phone ?? null,
        location: fi?.location ?? null,
        website: fi?.website ?? null,
        team_name_input: fi?.team_name ?? null,
        brokerage_input: fi?.brokerage ?? null,
        hs_ticket_url: row.hs_ticket_url,
        team_size_count: teamData?.team_size_count ?? null,
        team_size_category: teamData?.team_size_category ?? null,
        team_name_enriched: teamData?.team_name ?? null,
        brokerage_enriched: teamData?.brokerage_name ?? null,
        team_page_url: teamData?.team_page_url ?? null,
        homepage_url: teamData?.homepage_url ?? null,
        team_size_confidence: teamData?.confidence ?? null,
        team_size_reasoning: teamData?.reasoning ?? null,
        team_members_count: Array.isArray(teamData?.team_members)
          ? (teamData.team_members as unknown[]).length : null,
        team_members: teamData?.team_members ?? null,
        agent_designation: teamData?.agent_designation ?? null,
        detected_crms: teamData?.detected_crms ?? null,
        contact_source: contactData?.source ?? null,
        contact_matched_on: contactData?.matched_on ?? null,
        zillow_profile_link: contactData?.profile_link ?? null,
        zillow_screen_name: contactData?.screen_name ?? null,
        zillow_full_name: contactData?.full_name ?? null,
        zillow_title: contactData?.title ?? null,
        zillow_business_name: contactData?.business_name ?? null,
        zillow_phone_cell: contactData?.phone_cell ?? null,
        zillow_phone_brokerage: contactData?.phone_brokerage ?? null,
        zillow_phone_business: contactData?.phone_business ?? null,
        zillow_email: contactData?.email ?? null,
        zillow_address_city: contactData?.address_city ?? null,
        zillow_address_state: contactData?.address_state ?? null,
        zillow_address_zip: contactData?.address_zip ?? null,
        zillow_is_top_agent: contactData?.is_top_agent ?? null,
        zillow_is_team: contactData?.is_team ?? null,
        zillow_is_premier_agent: contactData?.is_premier_agent ?? null,
        zillow_team_name: contactData?.team_name ?? null,
        zillow_team_role: contactData?.team_role ?? null,
        zillow_team_member_count: contactData?.team_member_count ?? null,
        zillow_rating_average: contactData?.rating_average ?? null,
        zillow_rating_count: contactData?.rating_count ?? null,
        zillow_sales_last_12_months: contactData?.sales_last_12_months ?? null,
        zillow_sales_total: contactData?.sales_total ?? null,
        zillow_average_price: contactData?.average_price ?? null,
        zillow_years_of_experience: contactData?.years_of_experience ?? null,
        zillow_specialties: contactData?.specialties ?? null,
        zillow_languages: contactData?.languages ?? null,
        zillow_website_url: contactData?.website_url ?? null,
        zillow_facebook_url: contactData?.facebook_url ?? null,
        zillow_instagram_url: contactData?.instagram_url ?? null,
        zillow_linkedin_url: contactData?.linkedin_url ?? null,
        zillow_tiktok_url: contactData?.tiktok_url ?? null,
        zillow_youtube_url: contactData?.youtube_url ?? null,
        zillow_member_since: contactData?.member_since ?? null,
        zillow_badge_name: contactData?.badge_name ?? null,
        zillow_profile_photo_url: contactData?.profile_photo_url ?? null,
        zillow_service_areas: contactData?.service_areas ?? null,
        mad_id: contactData?.id ?? null,
        mad_first_name: contactData?.first_name ?? null,
        mad_last_name: contactData?.last_name ?? null,
        mad_job_title: contactData?.job_title ?? null,
        mad_company_domain: contactData?.company_domain ?? null,
        mad_team_id: contactData?.mad_team_id ?? null,
        mad_team_category_id: contactData?.team_category_id ?? null,
        mad_brokerage_id: contactData?.brokerage_id ?? null,
        mad_transactions_last_12m: contactData?.transactions_last_12m ?? null,
        enriched_at: new Date().toISOString(),
        branch1_found: !!teamData,
        branch2_found: !!contactData,
      }

      await supabaseAdmin
        .from('enrich_rows')
        .update({ merged_data: merged })
        .eq('id', row.id as string)
    }))
  }

  console.log('[Merge] Complete')
}
