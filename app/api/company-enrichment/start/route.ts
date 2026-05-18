import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'

const REQUIRED_COLUMNS = ['MAD_ID', 'Team Name', 'Brokerage', 'Location'] as const

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
  const parseResult = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
  })

  if (parseResult.data.length === 0) {
    return Response.json({ error: 'CSV is empty' }, { status: 400 })
  }

  const headers = Object.keys(parseResult.data[0])
  const missing = REQUIRED_COLUMNS.filter(col => !headers.includes(col))
  if (missing.length > 0) {
    return Response.json(
      { error: `CSV is missing required columns: ${missing.join(', ')}` },
      { status: 400 }
    )
  }

  const rows = parseResult.data
  const rowCount = rows.length

  const { data: batchId, error: batchErr } = await supabaseAdmin.rpc('ce_create_batch', {
    p_source_file: file.name,
    p_total_rows: rowCount,
  })
  if (batchErr) {
    console.error(batchErr.message)
    return Response.json({ error: 'Failed to create batch' }, { status: 500 })
  }

  const teams = rows.map(row => ({
    mad_id: row['MAD_ID'] ?? '',
    team_name: row['Team Name'] ?? '',
    brokerage: row['Brokerage'] ?? '',
    location: row['Location'] ?? '',
  }))

  const { error: teamsErr } = await supabaseAdmin.rpc('ce_insert_teams', {
    p_batch_id: batchId as string,
    p_teams: teams,
  })
  if (teamsErr) {
    console.error(teamsErr.message)
    return Response.json({ error: 'Failed to insert teams' }, { status: 500 })
  }

  // Fire find-website pipeline (fire-and-forget)
  const appUrl = env.NEXT_PUBLIC_APP_URL
  fetch(`${appUrl}/api/company-enrichment/find-website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_id: batchId }),
  }).catch((err: Error) => console.error('find-website trigger failed:', err.message))

  return Response.json({ data: { batch_id: batchId as string, row_count: rowCount } }, { status: 201 })
}
