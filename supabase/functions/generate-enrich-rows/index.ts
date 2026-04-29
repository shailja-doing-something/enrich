import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const TARGET_FIELDS = [
  'list_name', 'list_email', 'list_phone', 'list_team_name',
  'list_brokerage', 'list_website', 'list_location', 'HS_Ticket'
]

function mapRowToBranches(
  rawRow: Record<string, string>,
  mapping: Record<string, { source_column: string | null }>,
  hsTicketUrl: string
) {
  const get = (field: string): string => {
    const sourceCol = mapping[field]?.source_column
    if (!sourceCol) return ''
    return rawRow[sourceCol] ?? ''
  }

  const teamSizeRow = {
    list_name: get('list_name'),
    list_email: get('list_email'),
    list_phone: get('list_phone'),
    list_team_name: get('list_team_name'),
    list_brokerage: get('list_brokerage'),
    list_website: get('list_website'),
    list_location: get('list_location'),
    HS_Ticket: hsTicketUrl,
  }

  const zillowRow = {
    list_name: get('list_name'),
    list_company: get('list_team_name'),
    list_location: get('list_location'),
    brokerage_name: get('list_brokerage'),
    list_mobile: get('list_phone'),
    list_email: get('list_email'),
    HS_ticket_link: hsTicketUrl,
  }

  return { teamSizeRow, zillowRow }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let jobId: string
  let columnMapping: Record<string, { source_column: string | null }>
  let hsTicketUrl: string
  let rawCsv: string

  try {
    const body = await req.json()
    jobId = body.jobId
    columnMapping = body.columnMapping
    hsTicketUrl = body.hsTicketUrl
    rawCsv = body.rawCsv

    if (!jobId || !columnMapping || !hsTicketUrl || !rawCsv) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Parse CSV manually — no papaparse in Deno edge runtime
  const lines = rawCsv.split('\n').filter(l => l.trim() !== '')
  if (lines.length < 2) {
    await supabase
      .from('enrich_jobs')
      .update({ status: 'failed', error_log: 'CSV has no data rows' })
      .eq('id', jobId)
    return new Response(
      JSON.stringify({ error: 'CSV has no data rows' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Parse headers — handle quoted fields
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseCSVLine(lines[0])
  const dataLines = lines.slice(1)

  // Build rows
  const insertRows = []
  for (let i = 0; i < dataLines.length; i++) {
    const values = parseCSVLine(dataLines[i])
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue

    const rawRow: Record<string, string> = {}
    headers.forEach((h, idx) => {
      rawRow[h] = values[idx] ?? ''
    })

    const { teamSizeRow, zillowRow } = mapRowToBranches(rawRow, columnMapping, hsTicketUrl)

    insertRows.push({
      job_id: jobId,
      row_index: i,
      hs_ticket_url: hsTicketUrl,
      raw_data: rawRow,
      team_size_input: teamSizeRow,
      zillow_input: zillowRow,
    })
  }

  // Insert in batches of 50
  const BATCH_SIZE = 50
  try {
    for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
      const batch = insertRows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from('enrich_rows').insert(batch)
      if (error) throw new Error(`Batch insert failed at row ${i}: ${error.message}`)
    }

    // Mark job ready
    await supabase
      .from('enrich_jobs')
      .update({
        status: 'ready',
        parsed_at: new Date().toISOString(),
        raw_row_count: insertRows.length,
      })
      .eq('id', jobId)

    return new Response(
      JSON.stringify({ success: true, rowCount: insertRows.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    await supabase
      .from('enrich_jobs')
      .update({
        status: 'failed',
        error_log: e instanceof Error ? e.message : 'Unknown error during row generation',
      })
      .eq('id', jobId)

    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Row generation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
