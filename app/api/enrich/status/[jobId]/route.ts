export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob } from '@/lib/supabase/jobs'

const paramsSchema = z.object({
  jobId: z.string().uuid(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid job ID' }, { status: 400 })
  }

  const job = await getJob(parsed.data.jobId)
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  const sourceHeaders: string[] = job.source_headers ?? []

  return Response.json({ data: { ...job, sourceHeaders } })
}
