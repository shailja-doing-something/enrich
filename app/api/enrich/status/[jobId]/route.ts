import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const paramsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid job ID' }, { status: 400 })
  }

  const { jobId } = parsed.data

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('enrich_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr) { console.error('[status] job fetch error:', jobErr.message); return Response.json({ error: jobErr.message }, { status: 500 }) }
  if (!job)   return Response.json({ error: 'Job not found' }, { status: 404 })

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('enrich_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('row_index', { ascending: true })

  if (rowsErr) { console.error('[status] rows fetch error:', rowsErr.message); return Response.json({ error: rowsErr.message }, { status: 500 }) }

  console.log(`[status] jobId=${jobId} stage1=${job.stage1_status} matched=${job.stage1_matched}/${job.total_rows} rows=${rows?.length ?? 0}`)
  return Response.json({ data: { job, rows: rows ?? [] } })
}
