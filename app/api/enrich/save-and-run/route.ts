import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'
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

  if (job.status !== 'awaiting_confirmation') {
    return Response.json(
      { error: `Job cannot be approved (current status: ${job.status})` },
      { status: 400 }
    )
  }

  if (job.approval_status === 'approved') {
    return Response.json({ error: 'Job is already approved' }, { status: 400 })
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
    // Removed — pending new pipeline integration
    // status: 'generating' was set here to trigger the Edge Function pipeline.
    // The pipeline now begins in a separate architecture after approval.
  })

  // Removed — pending new pipeline integration
  // The generate-enrich-rows Edge Function call was here. It triggered the
  // full enrichment pipeline (row generation → auto-run → branch1 + branch2 → merge).
  // That trigger has been removed. See supabase/functions/generate-enrich-rows/index.ts.

  return Response.json({ data: { jobId, approval_status: 'approved' } })
}
