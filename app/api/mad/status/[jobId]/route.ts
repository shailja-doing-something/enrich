export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
}

const paramsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid job ID' }, { status: 400, headers: NO_CACHE })
  }

  const { jobId } = parsed.data

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('mad_enrich_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr) {
    console.error('[mad/status] job fetch error:', jobErr.message)
    return NextResponse.json({ error: jobErr.message }, { status: 500, headers: NO_CACHE })
  }
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404, headers: NO_CACHE })

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('mad_enrich_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('row_index', { ascending: true })

  if (rowsErr) {
    console.error('[mad/status] rows fetch error:', rowsErr.message)
    return NextResponse.json({ error: rowsErr.message }, { status: 500, headers: NO_CACHE })
  }

  console.log(`[mad/status] jobId=${jobId} status=${job.status} matched=${job.matched}/${job.total_rows} rows=${rows?.length ?? 0}`)
  return NextResponse.json({ data: { job, rows: rows ?? [] } }, { headers: NO_CACHE })
}
