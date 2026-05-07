import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'

const bodySchema = z.object({
  jobId: z.string().uuid(),
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://enrich-production-1129.up.railway.app'

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

  await updateJob(jobId, { status: 'both_running' })

  // Fire Railway pipeline route — no timeout issues
  fetch(`${APP_URL}/api/enrich/pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  }).catch(err => console.error('[AutoRun] Pipeline fire failed:', err))

  return Response.json({ ok: true })
}
