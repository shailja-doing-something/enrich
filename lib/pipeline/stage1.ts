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
    const { error: startErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage1_status: 'running' })
      .eq('id', jobId)
    if (startErr) {
      console.error('[stage1] Failed to set running status:', startErr)
      throw new Error(startErr.message)
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
      await supabaseAdmin
        .from('enrich_jobs')
        .update({ stage1_matched: matchedCount })
        .eq('id', jobId)
    }

    const { error: doneErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({
        stage1_status:       'done',
        stage1_matched:      matchedCount,
        stage1_completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    if (doneErr) throw new Error(doneErr.message)

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
    const { error } = await supabaseAdmin
      .from('enrich_rows')
      .update({
        zillow_url:          result.zillow_url,
        match_type:          result.match_type,
        zillow_profile:      result.zillow_profile,
        stage1_completed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    if (error) console.error(`[stage1] Failed to update row ${row.id}:`, error.message)
    return result
  } catch (err) {
    console.error(`[stage1] processRow crashed for row ${row.id}:`, err)
    return { zillow_url: null, match_type: 'no_match', zillow_profile: {} }
  }
}

async function lookupZillowProfile(row: EnrichRow): Promise<LookupResult> {
  console.log(`[lookup] row=${row.id} email=${row.email} name=${row.name} company=${row.company}`)

  // 1. Email
  if ((row.email ?? '').trim()) {
    try {
      const { data, error } = await supabaseAdmin
        .rpc('find_zillow_by_email', { p_email: row.email!.trim() })
      if (error) console.error('[lookup] email rpc error:', error)
      if (!error && data?.profile_link) {
        return {
          zillow_url:    data.profile_link as string,
          match_type:    'email',
          zillow_profile: data as Record<string, unknown>,
        }
      }
    } catch (e) { console.error('[lookup] email error', e) }
  }

  // 2. Name + company — fires (name, company) and (company, name) in parallel, takes first hit
  const name    = (row.name    ?? '').trim()
  const company = (row.company ?? '').trim()
  if (name && company) {
    try {
      const [resA, resB] = await Promise.all([
        supabaseAdmin.rpc('find_zillow_by_name_team', { p_name: name,    p_company: company }),
        supabaseAdmin.rpc('find_zillow_by_name_team', { p_name: company, p_company: name    }),
      ])
      if (resA.error) console.error('[lookup] name_team rpc error (A):', resA.error)
      if (resB.error) console.error('[lookup] name_team rpc error (B):', resB.error)
      const hit = resA.data ?? resB.data
      if (hit?.profile_link) {
        return {
          zillow_url:    hit.profile_link as string,
          match_type:    'name_team',
          zillow_profile: hit as Record<string, unknown>,
        }
      }
    } catch (e) { console.error('[lookup] name_team error', e) }
  }

  // 3. Name fuzzy + state (phone lookup removed — phone_cell has no index, times out)
  if (name) {
    try {
      const stateMatch = (row.location ?? '').match(/,\s*([A-Z]{2})\s*$/)
      const stateCode  = stateMatch?.[1] ?? ''
      const { data, error } = await supabaseAdmin
        .rpc('find_zillow_by_name_state', { p_name: name, p_state: stateCode })
      if (error) console.error('[lookup] name_fuzzy rpc error:', error)
      if (!error && data?.profile_link) {
        return {
          zillow_url:    data.profile_link as string,
          match_type:    'name_fuzzy',
          zillow_profile: data as Record<string, unknown>,
        }
      }
    } catch (e) { console.error('[lookup] name_fuzzy error', e) }
  }

  return { zillow_url: null, match_type: 'no_match', zillow_profile: {} }
}
