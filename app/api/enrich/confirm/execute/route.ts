import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob } from '@/lib/supabase/jobs'
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

  if (job.status !== 'generating') {
    return Response.json(
      { error: `Job is not in generating state (current status: ${job.status})` },
      { status: 400 }
    )
  }

  const edgeUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-enrich-rows`

  fetch(edgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      jobId: job.id,
      columnMapping: job.column_mapping,
      hsTicketUrl: job.hs_ticket_url,
      rawCsv: job.raw_csv,
    }),
  }).catch(err => console.error('Edge fn error:', err))

  return Response.json({ jobId, status: 'generating' })
}
