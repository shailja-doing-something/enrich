import { supabaseAdmin } from '@/lib/supabase/client'
import type { EnrichRow } from '@/lib/supabase/types'

export async function runStage2(jobId: string): Promise<void> {
  console.log(`[stage2] Starting for job ${jobId}`)
  try {
    const { error: startErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage2_status: 'running' })
      .eq('id', jobId)
    if (startErr) {
      console.error('[stage2] Failed to set running status:', startErr)
      throw new Error(startErr.message)
    }

    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .not('zillow_url', 'is', null)
      .is('stage2_completed_at', null)

    if (fetchErr) throw new Error(fetchErr.message)

    const enrichable = (rows ?? []) as EnrichRow[]
    console.log(`[stage2] jobId=${jobId} enrichable rows=${enrichable.length}`)

    let enrichedCount = 0
    const BATCH = 10
    for (let i = 0; i < enrichable.length; i += BATCH) {
      const slice = enrichable.slice(i, i + BATCH)
      await Promise.all(slice.map(row => markRowDone(row)))
      enrichedCount += slice.length
      // Write live progress after every batch so the UI updates in real time
      await supabaseAdmin
        .from('enrich_jobs')
        .update({ stage2_enriched: enrichedCount })
        .eq('id', jobId)
    }

    const { error: doneErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({
        stage2_status:       'done',
        stage2_enriched:     enrichedCount,
        stage2_completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    if (doneErr) throw new Error(doneErr.message)

    console.log(`[stage2] Done for job ${jobId} enriched=${enrichedCount}`)

  } catch (err) {
    console.error('[stage2] FATAL ERROR', err)
    await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage2_status: 'error' })
      .eq('id', jobId)
  }
}

async function markRowDone(row: EnrichRow): Promise<void> {
  // TODO: Replace with team size lookup when table is provided
  console.log(`[stage2] team size TBD — skipping row ${row.id}`)
  const { error } = await supabaseAdmin
    .from('enrich_rows')
    .update({ stage2_completed_at: new Date().toISOString() })
    .eq('id', row.id)
  if (error) console.error(`[stage2] Failed to update row ${row.id}:`, error.message)
}
