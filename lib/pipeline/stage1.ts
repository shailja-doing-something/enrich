import { supabaseAdmin } from '@/lib/supabase/client'
import { zillowDb } from '@/lib/supabase/zillowClient'
import type { EnrichRow } from '@/lib/supabase/types'

type LookupResult =
  | { zillow_url: string;  match_type: 'email' | 'name_team' | 'phone' | 'name_fuzzy' }
  | { zillow_url: null;    match_type: 'no_match' }

export async function runStage1(jobId: string): Promise<void> {
  console.log(`[stage1] Starting for job ${jobId}`)
  try {
    const { error: startErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage1_status: 'running' })
      .eq('id', jobId)
    if (startErr) {
      console.error('[stage1] Failed to set running status:', startErr)
      throw new Error(startErr.message)
    }

    // Verify Zillow DB connectivity before processing rows
    try {
      const { count, error: pingErr } = await zillowDb
        .from('zillow_agent_profiles')
        .select('*', { count: 'exact', head: true })
      if (pingErr) console.error('[stage1] Zillow DB connectivity error:', pingErr)
      else console.log(`[stage1] Zillow DB reachable, approx rows=${count}`)
    } catch (e) {
      console.error('[stage1] Zillow DB connectivity check threw:', e)
    }

    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .is('stage1_completed_at', null)

    if (fetchErr) throw new Error(fetchErr.message)

    const pending = (rows ?? []) as EnrichRow[]
    console.log(`[stage1] jobId=${jobId} rows=${pending.length}`)

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

    console.log(`[stage1] Done for job ${jobId} matched=${matched ?? 0}`)

  } catch (err) {
    console.error('[stage1] FATAL ERROR', err)
    await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage1_status: 'error' })
      .eq('id', jobId)
  }
}

async function processRow(row: EnrichRow): Promise<void> {
  try {
    const result = await lookupZillowProfile(row)
    const { error } = await supabaseAdmin
      .from('enrich_rows')
      .update({
        zillow_url:          result.zillow_url,
        match_type:          result.match_type,
        stage1_completed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    if (error) console.error(`[stage1] Failed to update row ${row.id}:`, error.message)
  } catch (err) {
    console.error(`[stage1] processRow crashed for row ${row.id}:`, err)
  }
}

async function lookupZillowProfile(row: EnrichRow): Promise<LookupResult> {
  console.log(`[lookup] row=${row.id} email=${row.email} name=${row.name} company=${row.company}`)

  // 1. Email
  if ((row.email ?? '').trim()) {
    const { data, error } = await zillowDb
      .from('zillow_agent_profiles')
      .select('profile_link')
      .ilike('email', row.email!.trim())
      .limit(1)
      .maybeSingle()
    if (error) console.error('[lookup] email query error:', error)
    if (profileLink(data)) return { zillow_url: profileLink(data)!, match_type: 'email' }
  }

  // 2. Name + company (skip if either is empty)
  const name    = (row.name    ?? '').trim()
  const company = (row.company ?? '').trim()
  if (name && company) {
    const [resA, resB] = await Promise.all([
      zillowDb
        .from('zillow_agent_profiles')
        .select('profile_link')
        .ilike('full_name',  `%${name}%`)
        .ilike('team_name',  `%${company}%`)
        .limit(1)
        .maybeSingle(),
      zillowDb
        .from('zillow_agent_profiles')
        .select('profile_link')
        .ilike('full_name',     `%${name}%`)
        .ilike('business_name', `%${company}%`)
        .limit(1)
        .maybeSingle(),
    ])
    if (resA.error) console.error('[lookup] name_team A query error:', resA.error)
    if (resB.error) console.error('[lookup] name_team B query error:', resB.error)
    const hit = profileLink(resA.data) ?? profileLink(resB.data)
    if (hit) return { zillow_url: hit, match_type: 'name_team' }
  }

  // 3. Phone (last 10 digits)
  const rawPhone = (row.phone ?? '').replace(/\D/g, '').slice(-10)
  if (rawPhone.length === 10) {
    const { data, error } = await zillowDb
      .from('zillow_agent_profiles')
      .select('profile_link')
      .eq('phone_cell', rawPhone)
      .limit(1)
      .maybeSingle()
    if (error) console.error('[lookup] phone query error:', error)
    if (profileLink(data)) return { zillow_url: profileLink(data)!, match_type: 'phone' }
  }

  // 4. Name fuzzy (optionally filtered by state)
  if (name) {
    const stateMatch = (row.location ?? '').match(/,\s*([A-Z]{2})\s*$/)
    const stateCode  = stateMatch?.[1] ?? null
    const base = zillowDb
      .from('zillow_agent_profiles')
      .select('profile_link')
      .ilike('full_name', `%${name}%`)
    const { data, error } = await (stateCode
      ? base.eq('address_state', stateCode).limit(1).maybeSingle()
      : base.limit(1).maybeSingle())
    if (error) console.error('[lookup] name_fuzzy query error:', error)
    if (profileLink(data)) return { zillow_url: profileLink(data)!, match_type: 'name_fuzzy' }
  }

  return { zillow_url: null, match_type: 'no_match' }
}

function profileLink(data: unknown): string | null {
  if (!data) return null
  const link = (data as Record<string, unknown>)['profile_link']
  return typeof link === 'string' && link ? link : null
}
