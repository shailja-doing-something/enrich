import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'
import { env } from '@/lib/env'

const bodySchema = z.object({
  jobId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { jobId } = parsed.data
  const appUrl = env.NEXT_PUBLIC_APP_URL

  const job = await getJob(jobId)
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  const bothDone = job.branch1_status === 'complete' && job.branch2_status === 'complete'
  const notAlreadyMerging = job.status !== 'complete' && job.status !== 'merging'

  if (bothDone && notAlreadyMerging) {
    await updateJob(jobId, { status: 'merging' })
    fetch(`${appUrl}/api/enrich/merge-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(err => console.error('merge-results trigger failed:', err))
    return Response.json({ triggered: true })
  }

  return Response.json({ triggered: false })
}
