import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import { z } from 'zod'
import { createJob, updateJob } from '@/lib/supabase/jobs'
import { detectColumnMapping } from '@/lib/enrichment/columnDetector'

const bodySchema = z.object({
  sheetUrl: z.string().min(1),
})

const ALLOWED_DOMAINS = ['docs.google.com', 'sheets.googleapis.com']

function toExportUrl(url: string): string {
  return url.replace(/\/(edit|view)[^?]*(\?.*)?$/, '/export?format=csv')
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { sheetUrl } = parsed.data

  let hostname: string
  try {
    hostname = new URL(sheetUrl).hostname
  } catch {
    return Response.json({ error: 'Invalid sheet URL' }, { status: 400 })
  }

  if (!ALLOWED_DOMAINS.includes(hostname)) {
    return Response.json({ error: 'Invalid sheet URL' }, { status: 400 })
  }

  const job = await createJob(sheetUrl)

  try {
    await updateJob(job.id, { status: 'parsing' })

    const csvUrl = toExportUrl(sheetUrl)
    const res = await fetch(csvUrl)
    if (!res.ok) {
      await updateJob(job.id, { status: 'failed', error_log: `CSV fetch failed: ${res.status}` })
      return Response.json({ error: 'Failed to fetch sheet' }, { status: 500 })
    }

    const csvText = await res.text()
    const parseResult = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    })

    const rows = parseResult.data
    if (rows.length === 0) {
      await updateJob(job.id, { status: 'failed', error_log: 'Sheet is empty' })
      return Response.json({ error: 'Sheet is empty' }, { status: 400 })
    }

    const headers = Object.keys(rows[0])

    await updateJob(job.id, { status: 'mapping', source_headers: headers })

    const columnMapping = await detectColumnMapping(headers)

    await updateJob(job.id, {
      status: 'awaiting_confirmation',
      column_mapping: columnMapping,
      raw_row_count: rows.length,
    })

    return Response.json({
      data: {
        jobId: job.id,
        rowCount: rows.length,
        columnMapping,
        status: 'awaiting_confirmation',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    await updateJob(job.id, { status: 'failed', error_log: message })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
