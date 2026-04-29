import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const parsed = z.string().uuid().safeParse(params.jobId)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid job ID' }, { status: 400 })
  }
  const jobId = parsed.data

  const { error: rowsError } = await supabaseAdmin
    .from('enrich_rows')
    .delete()
    .eq('job_id', jobId)

  if (rowsError) {
    return Response.json({ error: rowsError.message }, { status: 500 })
  }

  const { error: jobError } = await supabaseAdmin
    .from('enrich_jobs')
    .delete()
    .eq('id', jobId)

  if (jobError) {
    return Response.json({ error: jobError.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
