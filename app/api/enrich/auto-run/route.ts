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

  const job = await getJob(jobId)
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'ready') {
    return Response.json({ ok: true }) // already running or done — silently ignore
  }

  await updateJob(jobId, { status: 'stage1_running' })

  // Fire run-enrichment-pipeline Edge Function fire-and-forget
  const edgeUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/run-enrichment-pipeline`
  fetch(edgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ jobId }),
  }).catch(err => console.error('run-enrichment-pipeline trigger failed:', err))

  return Response.json({ ok: true })
}
