import { supabaseAdmin } from './client'
import type { EnrichJob } from './types'

export async function createJob(sheetUrl: string): Promise<EnrichJob> {
  const { data, error } = await supabaseAdmin
    .from('enrich_jobs')
    .insert({ sheet_url: sheetUrl, status: 'pending' })
    .select()
    .single()

  if (error) throw new Error(`Failed to create job: ${error.message}`)
  return data as EnrichJob
}

export async function updateJob(id: string, fields: Partial<EnrichJob>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('enrich_jobs')
    .update(fields)
    .eq('id', id)

  if (error) throw new Error(`Failed to update job ${id}: ${error.message}`)
}

export async function getJob(id: string): Promise<EnrichJob | null> {
  const { data, error } = await supabaseAdmin
    .from('enrich_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Failed to get job ${id}: ${error.message}`)
  return data as EnrichJob | null
}

export async function listJobs(): Promise<EnrichJob[]> {
  const { data, error } = await supabaseAdmin
    .from('enrich_jobs')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list jobs: ${error.message}`)
  return (data ?? []) as EnrichJob[]
}
