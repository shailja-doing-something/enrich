import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'
import type { ColumnMapping } from '@/lib/supabase/types'
import { env } from '@/lib/env'

const columnMappingFieldSchema = z.object({
  source_column: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
})

const columnMappingSchema = z.object({
  name: columnMappingFieldSchema,
  email: columnMappingFieldSchema,
  phone: columnMappingFieldSchema,
  team_name: columnMappingFieldSchema,
  brokerage: columnMappingFieldSchema,
  website: columnMappingFieldSchema,
  location: columnMappingFieldSchema,
})

const bodySchema = z.object({
  jobId: z.string().uuid(),
  columnMapping: columnMappingSchema,
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { jobId, columnMapping } = parsed.data

  const job = await getJob(jobId)
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'awaiting_confirmation') {
    return Response.json(
      { error: `Job is not awaiting confirmation (current status: ${job.status})` },
      { status: 400 }
    )
  }

  if (!job.hs_ticket_url) {
    return Response.json({ error: 'HubSpot ticket URL missing from job. Please start over.' }, { status: 400 })
  }

  if (!job.raw_csv) {
    return Response.json({ error: 'Raw CSV missing from job. Please start over.' }, { status: 400 })
  }

  await updateJob(jobId, {
    column_mapping: columnMapping as ColumnMapping,
    mapping_confirmed: true,
    status: 'generating',
  })

  const edgeFunctionUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-enrich-rows`

  const response = NextResponse.json({ data: { jobId, status: 'generating' } })

  fetch(edgeFunctionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      jobId: job.id,
      columnMapping,
      hsTicketUrl: job.hs_ticket_url,
      rawCsv: job.raw_csv,
    }),
  }).catch(err => {
    console.error('Edge function call failed:', err)
  })

  return response
}
