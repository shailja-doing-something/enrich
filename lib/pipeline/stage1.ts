import { supabaseAdmin } from '@/lib/supabase/client'
import type { EnrichRow } from '@/lib/supabase/types'

type LookupResult = {
  zillow_url:     string | null
  match_type:     string
  zillow_profile: Record<string, unknown>
}

type ProfileRow = { profile_link?: string } & Record<string, unknown>

export async function runStage1(jobId: string): Promise<void> {
  console.log(`[stage1] Starting for job ${jobId}`)
  try {
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

    const { data: jobData } = await supabaseAdmin
      .from('enrich_jobs')
      .select('match_config')
      .eq('id', jobId)
      .single()
    const config: string[][] = ((jobData as Record<string, unknown>)?.match_config as string[][] | null) ?? []
    console.log(`[stage1] jobId=${jobId} steps=${config.length}`)

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
      const results = await Promise.all(slice.map(row => processRow(row, config)))
      for (const result of results) {
        if (result.zillow_url !== null) matchedCount++
      }
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

async function processRow(row: EnrichRow, config: string[][]): Promise<LookupResult> {
  try {
    const result = await lookupZillowProfile(row, config)
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

async function lookupZillowProfile(
  row: EnrichRow,
  config: string[][]
): Promise<LookupResult> {
  const name      = (row.name    ?? '').trim()
  const email     = (row.email   ?? '').trim()
  const company   = (row.company ?? '').trim()
  const rawPhone  = (row.phone   ?? '').replace(/\D/g, '').slice(-10)
  const website   = (row.website ?? '').trim()
  const stateMatch = (row.location ?? '').match(/,\s*([A-Z]{2})\s*$/)
  const stateCode  = stateMatch?.[1] ?? ''
  const nameParts  = name.split(/\s+/)
  const first = nameParts[0] ?? ''
  const last  = nameParts.slice(1).join(' ')

  console.log(`[lookup] row=${row.id} email=${email} name=${name} company=${company} phone=${rawPhone} website=${website} state=${stateCode}`)

  async function rpc(rpcName: string, params: Record<string, unknown>): Promise<ProfileRow | null> {
    try {
      const { data, error } = await supabaseAdmin.rpc(rpcName, params)
      if (error) { console.error(`[lookup] ${rpcName} error`, error); return null }
      return data as ProfileRow | null
    } catch (e) { console.error(`[lookup] ${rpcName} threw`, e); return null }
  }

  for (const step of config) {
    const cols = step.map(c => c.toLowerCase())
    const hasEmail    = cols.includes('email')
    const hasName     = cols.includes('name')
    const hasCompany  = cols.includes('company')
    const hasWebsite  = cols.includes('website')
    const hasPhone    = cols.includes('phone')
    const hasLocation = cols.includes('location')

    if (hasEmail    && !email)              continue
    if (hasName     && (!first || !last))   continue
    if (hasCompany  && !company)            continue
    if (hasWebsite  && !website)            continue
    if (hasPhone    && rawPhone.length !== 10) continue
    if (hasLocation && !stateCode)          continue

    const key = [...cols].sort().join('+')
    let data: ProfileRow | null = null

    if (key === 'company+email') {
      data = await rpc('find_zillow_by_email_company', { p_email: email, p_company: company })
    } else if (key === 'email') {
      data = await rpc('find_zillow_by_email', { p_email: email })
    } else if (key === 'company+name') {
      data = await rpc('find_zillow_by_name_team', { p_name: name, p_company: company })
    } else if (key === 'website') {
      data = await rpc('find_zillow_by_website', { p_website: website })
    } else if (key === 'name+phone') {
      data = await rpc('find_zillow_by_phone_name', { p_phone: rawPhone, p_name: name })
    } else if (key === 'company+location+name') {
      data = await rpc('find_zillow_by_name_company_state', { p_name: name, p_company: company, p_state: stateCode })
    } else if (key === 'location+name') {
      data = await rpc('find_zillow_by_name_state', { p_name: name, p_state: stateCode })
    } else if (key === 'email+location') {
      data = await rpc('find_zillow_by_email', { p_email: email })
    } else if (key === 'company+email+location') {
      data = await rpc('find_zillow_by_email_company', { p_email: email, p_company: company })
    } else {
      console.warn('[stage1] unknown step combo:', key)
      continue
    }

    if (data?.profile_link) {
      return {
        zillow_url:     data.profile_link as string,
        match_type:     key.replace(/\+/g, '_'),
        zillow_profile: data,
      }
    }
  }

  return { zillow_url: null, match_type: 'no_match', zillow_profile: {} }
}
