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

  let jobId: string | undefined
  try {
    const job = await createJob(sheetUrl)
    jobId = job.id

    await updateJob(jobId, { status: 'parsing' })

    const csvUrl = toExportUrl(sheetUrl)
    const res = await fetch(csvUrl)
    if (!res.ok) {
      await updateJob(jobId, { status: 'failed', error_log: `CSV fetch failed: ${res.status}` })
      return Response.json({ error: 'Failed to fetch sheet' }, { status: 500 })
    }

    const csvText = await res.text()
    const parseResult = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    })

    const rows = parseResult.data
    if (rows.length === 0) {
      await updateJob(jobId, { status: 'failed', error_log: 'Sheet is empty' })
      return Response.json({ error: 'Sheet is empty' }, { status: 400 })
    }

    const headers = Object.keys(rows[0])

    await updateJob(jobId, { status: 'mapping', source_headers: headers })

    const columnMapping = await detectColumnMapping(headers)

    await updateJob(jobId, {
      status: 'awaiting_confirmation',
      column_mapping: columnMapping,
      raw_row_count: rows.length,
    })

    return Response.json({
      data: {
        jobId,
        rowCount: rows.length,
        columnMapping,
        status: 'awaiting_confirmation',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    if (jobId) {
      await updateJob(jobId, { status: 'failed', error_log: message }).catch(() => {})
    }
    return Response.json({ error: message }, { status: 500 })
  }
}
