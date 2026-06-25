import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { parseCSV } from '@/lib/csv/parse'
export async function POST(request: NextRequest) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing or invalid file field' }, { status: 400 })
  }

  const text = await file.text()
  const rows = parseCSV(text)

  const validation = z.array(z.unknown()).min(1, 'CSV has no valid rows (Name or Email required per row)')
    .safeParse(rows)
  if (!validation.success) {
    return Response.json({ error: validation.error.issues[0]?.message ?? 'Invalid CSV' }, { status: 400 })
  }

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('enrich_jobs')
    .insert({ filename: file.name, total_rows: rows.length })
    .select('id')
    .single()

  if (jobErr || !job) {
    return Response.json({ error: 'Failed to create job' }, { status: 500 })
  }

  const jobId = (job as Record<string, unknown>)['id'] as string

  const inserts = rows.map((row, index) => ({
    job_id:       jobId,
    row_index:    index,
    name:         row.name     || null,
    email:        row.email    || null,
    phone:        row.phone    || null,
    location:     row.location || null,
    website:      row.website  || null,
    company:      row.company  || null,
    extra_fields: row.extra_fields,
  }))

  const { error: rowsErr } = await supabaseAdmin
    .from('enrich_rows')
    .insert(inserts)

  if (rowsErr) {
    return Response.json({ error: 'Failed to insert rows' }, { status: 500 })
  }

  // Fire Stage 1 as its own request so it gets a full lifecycle on Railway.
  // A bare function call gets killed when this response is sent.
  // Use the Host header directly — x-forwarded-host can be unreliable on Railway.
  const host     = request.headers.get('host') ?? 'localhost:3000'
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const baseUrl  = `${protocol}://${host}`

  fetch(`${baseUrl}/api/enrich/run/${jobId}`, { method: 'POST' })
    .catch(err => console.error('[upload] failed to trigger run route:', err))

  return Response.json({ data: { job_id: jobId } })
}
