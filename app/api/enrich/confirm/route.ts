import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'
import { supabaseAdmin } from '@/lib/supabase/client'
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

  await updateJob(jobId, {
    column_mapping: columnMapping as ColumnMapping,
    mapping_confirmed: true,
    status: 'generating',
  })

  const response = NextResponse.json({ data: { jobId, status: 'generating' } })

  setImmediate(async () => {
    try {
      const freshJob = await getJob(jobId)
      if (!freshJob?.raw_csv) {
        await updateJob(jobId, { status: 'failed', error_log: 'Original CSV not found' })
        return
      }

      const hsTicketUrl = freshJob.hs_ticket_url!

      const parseResult = Papa.parse<Record<string, string>>(freshJob.raw_csv, {
        header: true,
        skipEmptyLines: true,
      })

      const rows = parseResult.data
      const insertRows: InsertEnrichRow[] = rows.map((row, rowIndex) => {
        const { teamSizeRow, zillowRow } = mapRowToBranches(row, columnMapping as ColumnMapping)
        teamSizeRow.HS_Ticket = hsTicketUrl
        zillowRow.HS_ticket_link = hsTicketUrl
        return {
          job_id: jobId,
          row_index: rowIndex,
          hs_ticket_url: hsTicketUrl,
          raw_data: row,
          team_size_input: teamSizeRow,
          zillow_input: zillowRow,
        }
      })

      const BATCH_SIZE = 50
      for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
        const batch = insertRows.slice(i, i + BATCH_SIZE)
        const { error } = await supabaseAdmin.from('enrich_rows').insert(batch)
        if (error) throw new Error(`Batch insert failed at offset ${i}: ${error.message}`)
        if (i + BATCH_SIZE < insertRows.length) {
          await new Promise((r) => setTimeout(r, 100))
        }
      }

      await updateJob(jobId, {
        status: 'ready',
        parsed_at: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(message)
      await updateJob(jobId, { status: 'failed', error_log: message }).catch(() => {})
    }
  })

  return response
}
