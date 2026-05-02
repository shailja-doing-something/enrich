import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'

const paramsSchema = z.object({ jobId: z.string().uuid() })

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid job ID' }, { status: 400 })
  }
  const { jobId } = parsed.data

  const job = await getJob(jobId)
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'ready') {
    return Response.json(
      { error: `Job is not ready (current status: ${job.status})` },
      { status: 400 }
    )
  }

  await updateJob(jobId, { status: 'stage1_running' })

  return Response.json({ jobId, status: 'stage1_running' })
}
