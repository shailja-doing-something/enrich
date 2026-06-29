export const maxDuration = 0
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runMadLookup } from '@/lib/pipeline/mad'

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
  console.log('[mad/run] received job', jobId)
  try {
    await runMadLookup(jobId)
    console.log('[mad/run] complete', jobId)
    return NextResponse.json({ data: { done: true } })
  } catch (e) {
    console.error('[mad/run] error', jobId, e)
    return NextResponse.json({ error: 'MAD lookup failed' }, { status: 500 })
  }
}
