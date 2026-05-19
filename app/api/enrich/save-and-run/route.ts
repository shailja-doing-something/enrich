import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'
import { env } from '@/lib/env'
import { classifyListType, buildColumnMappingReport } from '@/lib/enrichment/columnDetector'
import type { ColumnMapping } from '@/lib/supabase/types'

const columnMappingFieldSchema = z.object({
  source_column: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
})

const listTypeSchema = z.enum(['A', 'B', 'C', 'D', 'E'])

const columnMappingReportSchema = z.object({
  mapped: z.array(z.object({
    targetField: z.enum(['name', 'email', 'phone', 'team_name', 'brokerage', 'website', 'location']),
    sourceColumn: z.string(),
    confidence: z.enum(['high', 'medium', 'low', 'none']),
  })),
  absent: z.array(z.enum(['name', 'email', 'phone', 'team_name', 'brokerage', 'website', 'location'])),
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

  if (job.status !== 'awaiting_confirmation' && job.status !== 'ready') {
    return Response.json(
      { error: `Job cannot be started (current status: ${job.status})` },
      { status: 400 }
    )
  }

  const listType = listTypeSchema.parse(classifyListType(columnMapping as ColumnMapping))
  const report = columnMappingReportSchema.parse(buildColumnMappingReport(columnMapping as ColumnMapping))

  await updateJob(jobId, {
    column_mapping: columnMapping as ColumnMapping,
    mapping_confirmed: true,
    list_type: listType,
    column_mapping_report: report,
    approval_status: 'approved',
    approved_at: new Date().toISOString(),
    status: 'generating',
  })

  if (!job.raw_csv) {
    await updateJob(jobId, {
      status: 'failed',
      error_log: 'raw_csv is null — CSV was not stored correctly on upload',
    })
    return Response.json({ error: 'raw_csv missing' }, { status: 400 })
  }

  // Fire generate-enrich-rows Edge Function fire-and-forget
  const edgeUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-enrich-rows`
  fetch(edgeUrl, {
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
  })
    .then(async r => {
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        console.error(`generate-enrich-rows returned ${r.status}: ${body}`)
        await updateJob(jobId, {
          status: 'failed',
          error_log: `Edge Function error ${r.status}: ${body.slice(0, 200)}`,
        })
      }
    })
    .catch(async err => {
      console.error('generate-enrich-rows trigger failed:', err)
      await updateJob(jobId, {
        status: 'failed',
        error_log: `Edge Function unreachable: ${String(err).slice(0, 200)}`,
      })
    })

  return Response.json({ jobId, status: 'generating' })
}
