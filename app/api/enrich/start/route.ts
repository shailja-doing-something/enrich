import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import { createJob, updateJob } from '@/lib/supabase/jobs'
import { detectColumnMapping } from '@/lib/enrichment/columnDetector'

export async function POST(request: NextRequest) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return Response.json({ error: 'No file uploaded' }, { status: 400 })
  }

  if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
    return Response.json({ error: 'Please upload a CSV file' }, { status: 400 })
  }

  const csvContent = await file.text()

  let jobId: string | undefined
  try {
    const job = await createJob(file.name)
    jobId = job.id

    await updateJob(jobId, { status: 'parsing' })

    const parseResult = Papa.parse<Record<string, string>>(csvContent, {
      header: true,
      skipEmptyLines: true,
    })

    const rows = parseResult.data
    if (rows.length === 0) {
      await updateJob(jobId, { status: 'failed', error_log: 'CSV is empty' })
      return Response.json({ error: 'CSV is empty' }, { status: 400 })
    }

    const headers = Object.keys(rows[0])

    await updateJob(jobId, { status: 'mapping' })

    const columnMapping = await detectColumnMapping(headers)

    await updateJob(jobId, {
      status: 'awaiting_confirmation',
      column_mapping: columnMapping,
      raw_row_count: rows.length,
      source_headers: headers,
      raw_csv: csvContent,
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
