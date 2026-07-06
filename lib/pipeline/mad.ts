import { supabaseAdmin } from '@/lib/supabase/client'
import type { MadEnrichRow } from '@/lib/supabase/types'
import { DEFAULT_MAD_CONFIG } from '@/lib/pipeline/strategies'

async function rpc<T>(
  name: string,
  params: Record<string, unknown>
): Promise<T | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc(name, params)
    if (error) {
      console.error(`[mad] ${name} error`, error)
      return null
    }
    return data as T | null
  } catch (e) {
    console.error(`[mad] ${name} threw`, e)
    return null
  }
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

async function lookupMadAgent(
  row: MadEnrichRow,
  configIds: string[]
): Promise<{
  match_type: string
  mad_profile: Record<string, unknown>
}> {
  const email    = (row.email ?? '').trim()
  const rawPhone = (row.phone ?? '').replace(/\D/g, '').slice(-10)
  const name     = (row.name  ?? '').trim()
  const stateMatch = (row.location ?? '').match(/,\s*([A-Z]{2})\s*$/)
  const stateCode  = stateMatch?.[1] ?? ''
  const { first, last } = splitName(name)

  console.log('[mad] config:', configIds)
  console.log('[mad] email:', email, 'name:', name, 'phone:', rawPhone, 'state:', stateCode)

  for (const strategyId of configIds) {
    let data: Record<string, unknown> | null = null

    switch (strategyId) {

      case 'email':
        if (!email) continue
        data = await rpc<Record<string, unknown>>('find_mad_agent_by_email', { p_email: email })
        break

      case 'phone':
        if (rawPhone.length !== 10) continue
        data = await rpc<Record<string, unknown>>('find_mad_agent_by_phone', { p_phone: rawPhone })
        break

      case 'name_exact_email':
        if (!first || !last || !email) continue
        data = await rpc<Record<string, unknown>>(
          'find_mad_agent_by_name_exact_email',
          { p_first_name: first, p_last_name: last, p_email: email })
        break

      case 'name_fuzzy_email':
        if (!first || !last || !email) continue
        data = await rpc<Record<string, unknown>>(
          'find_mad_agent_by_name_fuzzy_email',
          { p_first_name: first, p_last_name: last, p_email: email })
        break

      case 'name_exact_phone':
        if (!first || !last || rawPhone.length !== 10) continue
        data = await rpc<Record<string, unknown>>(
          'find_mad_agent_by_name_exact_phone',
          { p_first_name: first, p_last_name: last, p_phone: rawPhone })
        break

      case 'name_fuzzy_phone':
        if (!first || !last || rawPhone.length !== 10) continue
        data = await rpc<Record<string, unknown>>(
          'find_mad_agent_by_name_fuzzy_phone',
          { p_first_name: first, p_last_name: last, p_phone: rawPhone })
        break

      case 'name_state_exact':
        if (!first || !last) continue
        data = await rpc<Record<string, unknown>>(
          'find_mad_agent_by_name_state_exact',
          { p_first_name: first, p_last_name: last, p_state: stateCode })
        break

      case 'name_state_fuzzy':
        if (!first || !last) continue
        data = await rpc<Record<string, unknown>>(
          'find_mad_agent_by_name_state',
          { p_first_name: first, p_last_name: last, p_state: stateCode })
        break

      case 'name_exact':
        if (!first || !last) continue
        data = await rpc<Record<string, unknown>>(
          'find_mad_agent_by_name_state_exact',
          { p_first_name: first, p_last_name: last, p_state: '' })
        break

      case 'name_fuzzy':
        if (!first || !last) continue
        data = await rpc<Record<string, unknown>>(
          'find_mad_agent_by_name_state',
          { p_first_name: first, p_last_name: last, p_state: '' })
        break

      default:
        console.warn('[mad] unknown strategy:', strategyId)
        continue
    }

    if (data?.agent_id) {
      return {
        match_type: strategyId,
        mad_profile: data,
      }
    }
  }

  return { match_type: 'no_match', mad_profile: {} }
}

export async function runMadLookup(jobId: string): Promise<void> {
  console.log('[mad] starting job', jobId)

  const { error: startErr } = await supabaseAdmin
    .from('mad_enrich_jobs')
    .update({ status: 'running' })
    .eq('id', jobId)
  if (startErr) {
    console.error('[mad] failed to set running', startErr)
    throw startErr
  }

  try {
    const { data: jobData } = await supabaseAdmin
      .from('mad_enrich_jobs')
      .select('match_config')
      .eq('id', jobId)
      .single()

    const raw = (jobData as Record<string, unknown>)?.match_config
    const configIds: string[] = (
      Array.isArray(raw) && raw.length > 0
    )
      ? (raw as unknown[]).flat().filter((x): x is string => typeof x === 'string')
      : DEFAULT_MAD_CONFIG
    console.log('[mad] using config:', configIds)

    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from('mad_enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .is('completed_at', null)
    if (rowsErr) throw rowsErr
    if (!rows || rows.length === 0) {
      await supabaseAdmin.from('mad_enrich_jobs').update({
        status: 'done',
        matched: 0,
        completed_at: new Date().toISOString(),
      }).eq('id', jobId)
      return
    }

    console.log(`[mad] processing ${rows.length} rows`)
    let matchedCount = 0
    const batchSize = 10

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      await Promise.all(batch.map(async (row) => {
        try {
          const { match_type, mad_profile } = await lookupMadAgent(row as MadEnrichRow, configIds)
          if (match_type !== 'no_match') matchedCount++
          await supabaseAdmin
            .from('mad_enrich_rows')
            .update({
              match_type,
              mad_profile,
              completed_at: new Date().toISOString(),
            })
            .eq('id', row.id)
        } catch (e) {
          console.error('[mad] row error', row.id, e)
          await supabaseAdmin
            .from('mad_enrich_rows')
            .update({
              match_type: 'no_match',
              mad_profile: {},
              completed_at: new Date().toISOString(),
            })
            .eq('id', row.id)
        }
      }))

      await supabaseAdmin
        .from('mad_enrich_jobs')
        .update({ matched: matchedCount })
        .eq('id', jobId)
      console.log(`[mad] batch done ${i + batch.length}/${rows.length}`)
    }

    await supabaseAdmin.from('mad_enrich_jobs').update({
      status: 'done',
      matched: matchedCount,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId)
    console.log(`[mad] done job=${jobId} matched=${matchedCount}`)

  } catch (e) {
    console.error('[mad] FATAL', e)
    await supabaseAdmin.from('mad_enrich_jobs')
      .update({ status: 'error' }).eq('id', jobId)
    throw e
  }
}
