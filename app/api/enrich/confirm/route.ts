import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'
import { createRows } from '@/lib/supabase/rows'
import { mapRowToBranches } from '@/lib/enrichment/columnMapper'
import type { ColumnMapping, InsertEnrichRow } from '@/lib/supabase/types'

const columnMappingFieldSchema = z.object({
  source_column: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
})

const columnMappingSchema = z.object({
  list_name: columnMappingFieldSchema,
  list_email: columnMappingFieldSchema,
  list_phone: columnMappingFieldSchema,
  list_team_name: columnMappingFieldSchema,
  list_brokerage: columnMappingFieldSchema,
  list_website: columnMappingFieldSchema,
  list_location: columnMappingFieldSchema,
  HS_Ticket: columnMappingFieldSchema,
})

const bodySchema = z.object({
  jobId: z.string().uuid(),
  columnMapping: columnMappingSchema,
  hs_ticket_url: z.string().min(1).startsWith('https://app.hubspot.com/'),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { jobId, columnMapping, hs_ticket_url } = parsed.data

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

  try {
    await updateJob(jobId, {
      column_mapping: columnMapping as ColumnMapping,
      mapping_confirmed: true,
      status: 'generating',
    })

    if (!job.raw_csv) {
      await updateJob(jobId, { status: 'failed', error_log: 'Original CSV not found' })
      return Response.json({ error: 'Original CSV not found. Please start over.' }, { status: 500 })
    }

    const parseResult = Papa.parse<Record<string, string>>(job.raw_csv, {
      header: true,
      skipEmptyLines: true,
    })

    const rows = parseResult.data
    const insertRows: InsertEnrichRow[] = rows.map((row, rowIndex) => {
      const { teamSizeRow, zillowRow } = mapRowToBranches(row, columnMapping as ColumnMapping)
      teamSizeRow.HS_Ticket = hs_ticket_url
      zillowRow.HS_ticket_link = hs_ticket_url
      return {
        job_id: jobId,
        row_index: rowIndex,
        hs_ticket_url,
        raw_data: row,
        team_size_input: teamSizeRow,
        zillow_input: zillowRow,
      }
    })

    await createRows(insertRows)

    await updateJob(jobId, {
      status: 'ready',
      parsed_at: new Date().toISOString(),
    })

    return Response.json({
      data: {
        jobId,
        rowCount: rows.length,
        status: 'ready',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    await updateJob(jobId, { status: 'failed', error_log: message })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
