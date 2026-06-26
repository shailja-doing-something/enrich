export const maxDuration = 0
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runStage1 } from '@/lib/pipeline/stage1'

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
  console.log('[run] received job', jobId)
  try {
    await runStage1(jobId)
    console.log('[run] stage1 complete', jobId)
    return NextResponse.json({ data: { done: true } })
  } catch (e) {
    console.error('[run] stage1 error', jobId, e)
    return NextResponse.json({ error: 'Stage 1 failed' }, { status: 500 })
  }
}
