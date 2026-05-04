export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import { z } from 'zod'
import { getJob } from '@/lib/supabase/jobs'
import { mapRowToGeneric } from '@/lib/enrichment/columnMapper'
import type { ColumnMapping } from '@/lib/supabase/types'

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

const COLUMNS = ['name', 'email', 'phone', 'team_name', 'brokerage', 'website', 'location', 'hs_ticket_url']

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

  if (!job.raw_csv) {
    return Response.json({ error: 'No CSV data found' }, { status: 400 })
  }

  const result = Papa.parse<Record<string, string>>(job.raw_csv, {
    header: true,
    skipEmptyLines: true,
  })

  const rows = result.data
  const preview = rows.slice(0, 10).map(row =>
    mapRowToGeneric(row, columnMapping as ColumnMapping, job.hs_ticket_url ?? '')
  )

  return Response.json({ preview, totalRows: rows.length, columns: COLUMNS })
}
