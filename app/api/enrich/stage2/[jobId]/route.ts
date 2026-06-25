import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { runStage2 } from '@/lib/pipeline/stage2'

const paramsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
})

export async function POST(
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
    .select('stage1_status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job)   return Response.json({ error: 'Job not found' }, { status: 404 })

  const jobRecord = job as Record<string, unknown>
  if (jobRecord['stage1_status'] !== 'done') {
    return Response.json(
      { error: 'Stage 1 must complete before Stage 2' },
      { status: 400 }
    )
  }

  runStage2(jobId).catch(err =>
    console.error('[stage2] fire-and-forget error:', err)
  )

  return Response.json({ data: { started: true } })
}
