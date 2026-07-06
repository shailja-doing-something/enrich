import { supabaseAdmin } from '@/lib/supabase/client'
import type { MadEnrichRow } from '@/lib/supabase/types'

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

const MAD_DEFAULT_CONFIG: string[][] = [
  ['Email'],
  ['Phone'],
  ['Name', 'Location'],
  ['Name'],
]

async function lookupMadAgent(
  row: MadEnrichRow,
  config: string[][]
): Promise<{
  match_type: string
  mad_profile: Record<string, unknown>
}> {
  const effectiveConfig = config.length > 0 ? config : MAD_DEFAULT_CONFIG
  console.log('[mad] config:', JSON.stringify(effectiveConfig))
  console.log('[mad] row email:', row.email, 'name:', row.name, 'phone:', row.phone)

  const email = (row.email ?? '').trim()
  const phone = (row.phone ?? '').replace(/\D/g, '').slice(-10)
  const name  = (row.name  ?? '').trim()
  const stateMatch = (row.location ?? '').match(/,\s*([A-Z]{2})\s*$/)
  const stateCode  = stateMatch?.[1] ?? ''
  const { first, last } = splitName(name)

  for (const step of effectiveConfig) {
    const cols = step.map(c => c.toLowerCase())
    const hasEmail    = cols.includes('email')
    const hasName     = cols.includes('name')
    const hasPhone    = cols.includes('phone')
    const hasLocation = cols.includes('location')

    if (hasEmail    && !email)            continue
    if (hasName     && (!first || !last)) continue
    if (hasPhone    && phone.length !== 10) continue
    if (hasLocation && !stateCode)        continue

    const key = [...cols].sort().join('+')
    let data: Record<string, unknown> | null = null

    if (key === 'email' || key === 'company+email' || key === 'email+location') {
      data = await rpc<Record<string, unknown>>('find_mad_agent_by_email', { p_email: email })
    } else if (key === 'phone' || key === 'name+phone') {
      data = await rpc<Record<string, unknown>>('find_mad_agent_by_phone', { p_phone: phone })
    } else if (key === 'email+name') {
      data = await rpc<Record<string, unknown>>('find_mad_agent_by_email', { p_email: email })
    } else if (key === 'location+name') {
      data = await rpc<Record<string, unknown>>(
        'find_mad_agent_by_name_state_exact',
        { p_first_name: first, p_last_name: last, p_state: stateCode })
    } else if (key === 'name' || key === 'company+name') {
      data = await rpc<Record<string, unknown>>(
        'find_mad_agent_by_name_state_exact',
        { p_first_name: first, p_last_name: last, p_state: '' })
    } else {
      console.warn('[mad] unknown step combo:', key)
      continue
    }

    if (data?.agent_id) {
      return {
        match_type: key.replace(/\+/g, '_'),
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
    const config: string[][] = ((jobData as Record<string, unknown>)?.match_config as string[][] | null) ?? []
    console.log(`[mad] steps=${config.length} config=${JSON.stringify(config)}`)

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
          const { match_type, mad_profile } = await lookupMadAgent(row as MadEnrichRow, config)
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
