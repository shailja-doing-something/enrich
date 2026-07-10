import { supabaseAdmin } from '@/lib/supabase/client'
import type { EnrichRow } from '@/lib/supabase/types'

const FALLBACK_ZILLOW_CONFIG = [
  'email_company',
  'email',
  'name_exact_email',
  'name_fuzzy_email',
  'email_phone',
  'email_state',
  'name_exact_company',
  'name_company',
  'website',
  'name_exact_phone',
  'name_fuzzy_phone',
  'phone_name_fuzzy',
  'phone',
  'name_exact_company_state',
  'name_company_state',
  'name_exact_email_state',
  'name_fuzzy_email_state',
  'name_exact_phone_state',
  'name_fuzzy_phone_state',
  'website_name_exact',
  'website_name_fuzzy',
  'website_state',
  'name_state_exact',
  'name_state_fuzzy',
]

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

    console.log('[stage1] job match_config:', JSON.stringify((jobData as Record<string, unknown>)?.match_config))

    let configIds: string[] = FALLBACK_ZILLOW_CONFIG
    try {
      const raw = (jobData as Record<string, unknown>)?.match_config
      if (Array.isArray(raw) && raw.length > 0) {
        const flat = (raw as unknown[]).flat().filter((x): x is string => typeof x === 'string')
        if (flat.length > 0) configIds = flat
      }
    } catch (e) {
      console.error('[stage1] config parse error, using fallback:', e)
    }

    console.log('[stage1] effectiveConfig:', JSON.stringify(configIds))

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
      const results = await Promise.all(slice.map(row => processRow(row, configIds)))
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

async function processRow(row: EnrichRow, configIds: string[]): Promise<LookupResult> {
  try {
    const result = await lookupZillowProfile(row, configIds)
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
  configIds: string[]
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

  for (const strategyId of configIds) {
    let data: ProfileRow | null = null

    switch (strategyId) {

      case 'email_company':
        if (!email || !company) continue
        data = await rpc('find_zillow_by_email_company', { p_email: email, p_company: company })
        break

      case 'email':
        if (!email) continue
        data = await rpc('find_zillow_by_email', { p_email: email })
        break

      case 'name_company':
        if (!name || !company) continue
        data = await rpc('find_zillow_by_name_team', { p_name: name, p_company: company })
        break

      case 'website':
        if (!website) continue
        data = await rpc('find_zillow_by_website', { p_website: website })
        break

      case 'phone_name_fuzzy':
        if (rawPhone.length !== 10 || !name) continue
        data = await rpc('find_zillow_by_phone_name', { p_phone: rawPhone, p_name: name })
        break

      case 'name_exact_email':
        if (!first || !last || !email) continue
        data = await rpc('find_zillow_by_name_exact_email', { p_first_name: first, p_last_name: last, p_email: email })
        break

      case 'name_fuzzy_email':
        if (!first || !last || !email) continue
        data = await rpc('find_zillow_by_name_fuzzy_email', { p_first_name: first, p_last_name: last, p_email: email })
        break

      case 'name_exact_phone':
        if (!first || !last || rawPhone.length !== 10) continue
        data = await rpc('find_zillow_by_name_exact_phone', { p_first_name: first, p_last_name: last, p_phone: rawPhone })
        break

      case 'name_fuzzy_phone':
        if (!first || !last || rawPhone.length !== 10) continue
        data = await rpc('find_zillow_by_name_fuzzy_phone', { p_first_name: first, p_last_name: last, p_phone: rawPhone })
        break

      case 'name_company_state':
        if (!name || !company || !stateCode) continue
        data = await rpc('find_zillow_by_name_company_state', { p_name: name, p_company: company, p_state: stateCode })
        break

      case 'name_state_fuzzy':
        if (!name) continue
        data = await rpc('find_zillow_by_name_state', { p_name: name, p_state: stateCode })
        break

      case 'name_state_exact':
        if (!first || !last) continue
        data = await rpc('find_zillow_by_name_state_exact', { p_first_name: first, p_last_name: last, p_state: stateCode })
        break

      case 'phone':
        if (rawPhone.length !== 10) continue
        data = await rpc('find_zillow_by_phone', { p_phone: rawPhone })
        break

      case 'email_state':
        if (!email) continue
        data = await rpc('find_zillow_by_email_state', { p_email: email, p_state: stateCode })
        break

      case 'email_phone':
        if (!email || rawPhone.length !== 10) continue
        data = await rpc('find_zillow_by_email_phone', { p_email: email, p_phone: rawPhone })
        break

      case 'name_exact_company':
        if (!first || !last || !company) continue
        data = await rpc('find_zillow_by_name_exact_company', { p_first_name: first, p_last_name: last, p_company: company })
        break

      case 'name_exact_company_state':
        if (!first || !last || !company) continue
        data = await rpc('find_zillow_by_name_exact_company_state', { p_first_name: first, p_last_name: last, p_company: company, p_state: stateCode })
        break

      case 'name_exact_email_state':
        if (!first || !last || !email) continue
        data = await rpc('find_zillow_by_name_exact_email_state', { p_first_name: first, p_last_name: last, p_email: email, p_state: stateCode })
        break

      case 'name_fuzzy_email_state':
        if (!first || !last || !email) continue
        data = await rpc('find_zillow_by_name_fuzzy_email_state', { p_first_name: first, p_last_name: last, p_email: email, p_state: stateCode })
        break

      case 'name_exact_phone_state':
        if (!first || !last || rawPhone.length !== 10) continue
        data = await rpc('find_zillow_by_name_exact_phone_state', { p_first_name: first, p_last_name: last, p_phone: rawPhone, p_state: stateCode })
        break

      case 'name_fuzzy_phone_state':
        if (!first || !last || rawPhone.length !== 10) continue
        data = await rpc('find_zillow_by_name_fuzzy_phone_state', { p_first_name: first, p_last_name: last, p_phone: rawPhone, p_state: stateCode })
        break

      case 'website_state':
        if (!website) continue
        data = await rpc('find_zillow_by_website_state', { p_website: website, p_state: stateCode })
        break

      case 'website_name_fuzzy':
        if (!website || !name) continue
        data = await rpc('find_zillow_by_website_name_fuzzy', { p_website: website, p_name: name })
        break

      case 'website_name_exact':
        if (!website || !first || !last) continue
        data = await rpc('find_zillow_by_website_name_exact', { p_website: website, p_first_name: first, p_last_name: last })
        break

      default:
        console.warn('[stage1] unknown strategy:', strategyId)
        continue
    }

    if (data?.profile_link) {
      return {
        zillow_url:     data.profile_link as string,
        match_type:     strategyId,
        zillow_profile: data,
      }
    }
  }

  return { zillow_url: null, match_type: 'no_match', zillow_profile: {} }
}
