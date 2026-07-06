export const dynamic = 'force-dynamic'

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

  const configRaw = formData.get('match_config')
  let matchConfig: string[][] = []
  if (configRaw && typeof configRaw === 'string') {
    try {
      matchConfig = JSON.parse(configRaw)
    } catch (e) {
      console.error('[mad/upload] failed to parse match_config:', configRaw, e)
    }
  }
  console.log('[mad/upload] match_config:', JSON.stringify(matchConfig))

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('mad_enrich_jobs')
    .insert({ filename: file.name, total_rows: rows.length, match_config: matchConfig })
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
    .from('mad_enrich_rows')
    .insert(inserts)

  if (rowsErr) {
    return Response.json({ error: 'Failed to insert rows' }, { status: 500 })
  }

  const host     = request.headers.get('host') ?? 'localhost:3000'
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const baseUrl  = `${protocol}://${host}`

  fetch(`${baseUrl}/api/mad/run/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }).catch(err => console.error('[mad/upload] trigger failed', err))

  return Response.json({ data: { job_id: jobId } })
}
