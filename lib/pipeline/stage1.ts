import { supabaseAdmin } from '@/lib/supabase/client'
import type { EnrichRow } from '@/lib/supabase/types'

type LookupResult = {
  zillow_url:    string | null
  match_type:    string
  zillow_profile: Record<string, unknown>
}

export async function runStage1(jobId: string): Promise<void> {
  console.log(`[stage1] Starting for job ${jobId}`)
  try {
    // Mark running — log 0 rows matched if the update hits no records
    const { data: runUpdated, error: startErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage1_status: 'running' })
      .eq('id', jobId)
      .select('id')
    if (startErr) {
      console.error('[stage1] Failed to set running status:', startErr)
      throw new Error(startErr.message)
    }
    if (!runUpdated?.length) {
      console.error('[stage1] running update matched 0 rows — jobId may be stale:', jobId)
    }

    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .is('stage1_completed_at', null)

    if (fetchErr) throw new Error(fetchErr.message)

    const pending = (rows ?? []) as EnrichRow[]
    console.log(`[stage1] jobId=${jobId} rows=${pending.length}`)

    let matchedCount = 0
    const BATCH = 10
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice   = pending.slice(i, i + BATCH)
      const results = await Promise.all(slice.map(row => processRow(row)))
      for (const result of results) {
        if (result.zillow_url !== null) matchedCount++
      }
      // Write live progress after every batch so the UI updates in real time
      const { data: counterUpdated, error: countError } = await supabaseAdmin
        .from('enrich_jobs')
        .update({ stage1_matched: matchedCount })
        .eq('id', jobId)
        .select('id')
      if (countError) console.error('[stage1] counter update failed:', countError)
      else if (!counterUpdated?.length) console.error('[stage1] counter update matched 0 rows — jobId:', jobId)
    }

    const { data: doneUpdated, error: doneErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({
        stage1_status:       'done',
        stage1_matched:      matchedCount,
        stage1_completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select('id')
    if (doneErr) throw new Error(doneErr.message)
    if (!doneUpdated?.length) console.error('[stage1] done update matched 0 rows — jobId:', jobId)

    console.log(`[stage1] Done for job ${jobId} matched=${matchedCount}`)

  } catch (err) {
    console.error('[stage1] FATAL ERROR', err)
    await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage1_status: 'error' })
      .eq('id', jobId)
  }
}

async function processRow(row: EnrichRow): Promise<LookupResult> {
  try {
    const result = await lookupZillowProfile(row)
    const { data: rowUpdated, error } = await supabaseAdmin
      .from('enrich_rows')
      .update({
        zillow_url:          result.zillow_url,
        match_type:          result.match_type,
        zillow_profile:      result.zillow_profile,
        stage1_completed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select('id')
    if (error) console.error(`[stage1] Failed to update row ${row.id}:`, error.message)
    else if (!rowUpdated?.length) console.error(`[stage1] row update matched 0 rows — rowId may be stale:`, row.id)
    return result
  } catch (err) {
    console.error(`[stage1] processRow crashed for row ${row.id}:`, err)
    return { zillow_url: null, match_type: 'no_match', zillow_profile: {} }
  }
}

type ProfileRow = { profile_link?: string } & Record<string, unknown>

async function lookupZillowProfile(row: EnrichRow): Promise<LookupResult> {
  const name      = (row.name    ?? '').trim()
  const email     = (row.email   ?? '').trim()
  const company   = (row.company ?? '').trim()
  const rawPhone  = (row.phone   ?? '').replace(/\D/g, '').slice(-10)
  const stateMatch = (row.location ?? '').match(/,\s*([A-Z]{2})\s*$/)
  const stateCode  = stateMatch?.[1] ?? ''

  console.log(`[lookup] row=${row.id} email=${email} name=${name} company=${company} phone=${rawPhone} state=${stateCode}`)

  async function rpc(rpcName: string, params: Record<string, unknown>): Promise<ProfileRow | null> {
    try {
      const { data, error } = await supabaseAdmin.rpc(rpcName, params)
      if (error) { console.error(`[lookup] ${rpcName} error`, error); return null }
      return data as ProfileRow | null
    } catch (e) { console.error(`[lookup] ${rpcName} threw`, e); return null }
  }

  // Step 1: Email + Company fuzzy
  if (email && company) {
    const data = await rpc('find_zillow_by_email_company', { p_email: email, p_company: company })
    if (data?.profile_link) return {
      zillow_url:    data.profile_link,
      match_type:    'email_company',
      zillow_profile: data,
    }
  }

  // Step 2: Email only
  if (email) {
    const data = await rpc('find_zillow_by_email', { p_email: email })
    if (data?.profile_link) return {
      zillow_url:    data.profile_link,
      match_type:    'email',
      zillow_profile: data,
    }
  }

  // Step 3: Name fuzzy + Company fuzzy
  if (name && company) {
    const data = await rpc('find_zillow_by_name_team', { p_name: name, p_company: company })
    if (data?.profile_link) return {
      zillow_url:    data.profile_link,
      match_type:    'name_team',
      zillow_profile: data,
    }
  }

  // Step 4: Phone + Email
  if (rawPhone.length === 10 && email) {
    const data = await rpc('find_zillow_by_phone_email', { p_phone: rawPhone, p_email: email })
    if (data?.profile_link) return {
      zillow_url:    data.profile_link,
      match_type:    'phone_email',
      zillow_profile: data,
    }
  }

  // Step 5: Name fuzzy + Company fuzzy + State
  if (name && company && stateCode) {
    const data = await rpc('find_zillow_by_name_company_state', { p_name: name, p_company: company, p_state: stateCode })
    if (data?.profile_link) return {
      zillow_url:    data.profile_link,
      match_type:    'name_company_state',
      zillow_profile: data,
    }
  }

  // Step 6: Name fuzzy + State
  if (name) {
    const data = await rpc('find_zillow_by_name_state', { p_name: name, p_state: stateCode })
    if (data?.profile_link) return {
      zillow_url:    data.profile_link,
      match_type:    'name_fuzzy',
      zillow_profile: data,
    }
  }

  // Step 7: No match
  return { zillow_url: null, match_type: 'no_match', zillow_profile: {} }
}
