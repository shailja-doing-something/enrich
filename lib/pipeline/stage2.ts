import { supabaseAdmin } from '@/lib/supabase/client'

// TODO: Replace the stub body of enrichRow() with real agent detail
// lookup when the details table is provided.

export async function runStage2(jobId: string): Promise<void> {
  try {
    const { error: startErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage2_status: 'running' })
      .eq('id', jobId)
    if (startErr) throw new Error(startErr.message)

    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('id, zillow_url')
      .eq('job_id', jobId)
      .not('zillow_url', 'is', null)
      .is('stage2_completed_at', null)

    if (fetchErr) throw new Error(fetchErr.message)

    const enrichable = (rows ?? []) as { id: string; zillow_url: string }[]

    const BATCH = 10
    for (let i = 0; i < enrichable.length; i += BATCH) {
      const slice = enrichable.slice(i, i + BATCH)
      await Promise.all(slice.map(row => enrichRow(row.id)))
    }

    const { error: doneErr } = await supabaseAdmin
      .from('enrich_jobs')
      .update({
        stage2_status: 'done',
        stage2_enriched: enrichable.length,
        stage2_completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    if (doneErr) throw new Error(doneErr.message)

  } catch (err) {
    console.error(`[Stage2] Error for job ${jobId}:`, err)
    await supabaseAdmin
      .from('enrich_jobs')
      .update({ stage2_status: 'error' })
      .eq('id', jobId)
  }
}

async function enrichRow(rowId: string): Promise<void> {
  // TODO: Replace with real agent detail lookup when table is provided.
  console.log(`Stage 2 table TBD — skipping row ${rowId}`)
  await supabaseAdmin
    .from('enrich_rows')
    .update({ stage2_completed_at: new Date().toISOString() })
    .eq('id', rowId)
}
