export const maxDuration = 0
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { runStage2 } from '@/lib/pipeline/stage2'

const paramsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
})

export async function POST(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid job ID' }, { status: 400 })
  }

  const { jobId } = parsed.data

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('enrich_jobs')
    .select('stage1_status')
    .eq('id', jobId)
    .single()

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })
  if (!job)   return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  if ((job as Record<string, unknown>)['stage1_status'] !== 'done') {
    return NextResponse.json({ error: 'Stage 1 must complete first' }, { status: 400 })
  }

  console.log('[stage2] received job', jobId)
  try {
    await runStage2(jobId)
    console.log('[stage2] complete', jobId)
    return NextResponse.json({ data: { done: true } })
  } catch (e) {
    console.error('[stage2] error', jobId, e)
    return NextResponse.json({ error: 'Stage 2 failed' }, { status: 500 })
  }
}
