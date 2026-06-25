import { NextRequest } from 'next/server'
import { z } from 'zod'
import { runStage1 } from '@/lib/pipeline/stage1'

// Internal route — called via fetch() from the upload handler so Stage 1
// runs in its own full request lifecycle instead of being orphaned after
// the upload response is sent.

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

  // Fire-and-forget — do NOT await. Railway kills the request after ~30s
  // but stage1 needs minutes. Returning immediately lets it run independently.
  runStage1(parsed.data.jobId).catch(err =>
    console.error('[run] runStage1 uncaught error:', err)
  )
  return Response.json({ data: { started: true } })
}
