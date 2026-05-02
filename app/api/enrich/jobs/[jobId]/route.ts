import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId: rawJobId } = await params
  const parsed = z.string().uuid().safeParse(rawJobId)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid job ID' }, { status: 400 })
  }
  const jobId = parsed.data

  try {
    const { error: rowsError } = await supabaseAdmin
      .from('enrich_rows')
      .delete()
      .eq('job_id', jobId)

    if (rowsError) {
      console.error('Delete rows error:', rowsError.message)
      return Response.json({ error: rowsError.message }, { status: 500 })
    }

    const { error: jobError } = await supabaseAdmin
      .from('enrich_jobs')
      .delete()
      .eq('id', jobId)

    if (jobError) {
      console.error('Delete job error:', jobError.message)
      return Response.json({ error: jobError.message }, { status: 500 })
    }

    return Response.json({ data: { deleted: true } }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('Delete handler error:', e)
    return Response.json({ error: 'Unexpected error during delete' }, { status: 500 })
  }
}
