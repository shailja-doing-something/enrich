import { supabaseAdmin } from './client'
import type { EnrichRow, InsertEnrichRow } from './types'

export async function createRows(rows: InsertEnrichRow[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('enrich_rows')
    .insert(rows)

  if (error) throw new Error(`Failed to insert rows: ${error.message}`)
}

export async function getRowsByJob(jobId: string): Promise<EnrichRow[]> {
  const { data, error } = await supabaseAdmin
    .from('enrich_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('row_index', { ascending: true })

  if (error) throw new Error(`Failed to get rows for job ${jobId}: ${error.message}`)
  return (data ?? []) as EnrichRow[]
}

export async function updateRow(id: string, fields: Partial<EnrichRow>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('enrich_rows')
    .update(fields)
    .eq('id', id)

  if (error) throw new Error(`Failed to update row ${id}: ${error.message}`)
}
