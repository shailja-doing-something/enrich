import { supabaseAdmin } from '@/lib/supabase/client'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params

    if (!jobId) {
      return Response.json({ error: 'Job ID required' }, { status: 400 })
    }

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

    return Response.json({ success: true }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('Delete handler error:', e)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
