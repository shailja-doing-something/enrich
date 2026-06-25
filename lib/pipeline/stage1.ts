import { supabaseAdmin } from '@/lib/supabase/client'
import { zillowDb } from '@/lib/supabase/zillowClient'
import type { EnrichRow } from '@/lib/supabase/types'

type LookupResult =
  | { zillow_url: string;  match_type: 'email' | 'name_team' | 'phone' | 'name_fuzzy' }
  | { zillow_url: null;    match_type: 'no_match' }

export async function runStage1(jobId: string): Promise<void> {
  console.log(`[Stage1] Starting for job ${jobId}`)
  try {
    const { error: startErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage1_status: 'running' })
      .eq('id', jobId)
    if (startErr) throw new Error(startErr.message)

    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .is('stage1_completed_at', null)

    if (fetchErr) throw new Error(fetchErr.message)

    const pending = (rows ?? []) as EnrichRow[]

    const BATCH = 10
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH)
      await Promise.all(slice.map(row => processRow(row)))
    }

    const { count: matched, error: countErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .not('zillow_url', 'is', null)

    if (countErr) throw new Error(countErr.message)

    const { error: doneErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({
        stage1_status: 'done',
        stage1_matched: matched ?? 0,
        stage1_completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    if (doneErr) throw new Error(doneErr.message)

  } catch (err) {
    console.error(`[Stage1] Error for job ${jobId}:`, err)
    await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage1_status: 'error' })
      .eq('id', jobId)
  }
}

async function processRow(row: EnrichRow): Promise<void> {
  const result = await lookupZillowProfile(row)
  const { error } = await supabaseAdmin
    .from('enrich_rows')
    .update({
      zillow_url:          result.zillow_url,
      match_type:          result.match_type,
      stage1_completed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  if (error) console.error(`[Stage1] Failed to update row ${row.id}:`, error.message)
}

async function lookupZillowProfile(row: EnrichRow): Promise<LookupResult> {
  // 1. Email
  if (row.email) {
    const { data, error } = await zillowDb
      .from('zillow_agent_profiles')
      .select('profile_link')
      .ilike('email', row.email.trim())
      .limit(1)
      .maybeSingle()

    const link = extractLink(data, error)
    if (link) return { zillow_url: link, match_type: 'email' }
  }

  // 2. Name + team name (queries A and B run simultaneously)
  if (row.name) {
    const name = row.name.trim()
    const [resA, resB] = await Promise.all([
      zillowDb
        .from('zillow_agent_profiles')
        .select('profile_link')
        .ilike('full_name', `%${name}%`)
        .ilike('team_name', `%${name}%`)
        .limit(1)
        .maybeSingle(),
      zillowDb
        .from('zillow_agent_profiles')
        .select('profile_link')
        .ilike('full_name', `%${name}%`)
        .ilike('business_name', `%${name}%`)
        .limit(1)
        .maybeSingle(),
    ])

    const link = extractLink(resA.data, resA.error) ?? extractLink(resB.data, resB.error)
    if (link) return { zillow_url: link, match_type: 'name_team' }
  }

  // 3. Phone (last 10 digits)
  if (row.phone) {
    const normalized = row.phone.replace(/\D/g, '').slice(-10)
    if (normalized.length === 10) {
      const { data, error } = await zillowDb
        .from('zillow_agent_profiles')
        .select('profile_link')
        .eq('phone_cell', normalized)
        .limit(1)
        .maybeSingle()

      const link = extractLink(data, error)
      if (link) return { zillow_url: link, match_type: 'phone' }
    }
  }

  // 4. Name fuzzy (full_name contains name, optionally filtered by state)
  if (row.name) {
    const name = row.name.trim()
    const stateMatch = row.location?.match(/,\s*([A-Z]{2})\s*$/)
    const stateCode = stateMatch?.[1]

    const query = zillowDb
      .from('zillow_agent_profiles')
      .select('profile_link')
      .ilike('full_name', `%${name}%`)

    const { data, error } = await (stateCode
      ? query.eq('address_state', stateCode).limit(1).maybeSingle()
      : query.limit(1).maybeSingle())

    const link = extractLink(data, error)
    if (link) return { zillow_url: link, match_type: 'name_fuzzy' }
  }

  // 5. No match
  return { zillow_url: null, match_type: 'no_match' }
}

function extractLink(data: unknown, error: unknown): string | null {
  if (error || !data) return null
  const link = (data as Record<string, unknown>)['profile_link']
  return typeof link === 'string' && link ? link : null
}
