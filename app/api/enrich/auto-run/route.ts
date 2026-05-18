import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob } from '@/lib/supabase/jobs'
// Removed — pending new pipeline integration
// import { updateJob } from '@/lib/supabase/jobs'
// const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '...'

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

  // Removed — pending new pipeline integration
  // The following were removed: status update to 'both_running' and the fire-and-forget
  // fetch to /api/enrich/pipeline. The pipeline now begins in a separate architecture.
  // await updateJob(jobId, { status: 'both_running' })
  // fetch(`${APP_URL}/api/enrich/pipeline`, { ... })

  return Response.json({ ok: true })
}
