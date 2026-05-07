import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function cleanPhone(raw: string): string {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length > 10) return digits.slice(-10)
  if (digits.length < 7) return ''
  return digits
}

function cleanEmail(raw: string): string {
  return (raw ?? '').trim().toLowerCase()
}

function cleanName(raw: string): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ')
}

function resolveField(
  rawRow: Record<string, string>,
  sourceColumn: string | null,
  separator: string = ' '
): string {
  if (!sourceColumn) return ''
  if (sourceColumn.includes('|')) {
    const parts = sourceColumn.split('|')
    return parts
      .map((col: string) => (rawRow[col.trim()] ?? '').trim())
      .filter(Boolean)
      .join(separator)
  }
  return (rawRow[sourceColumn] ?? '').trim()
}

function mapRowToGeneric(
  rawRow: Record<string, string>,
  mapping: Record<string, { source_column: string | null }>,
  hsTicketUrl: string
) {
  const name = resolveField(rawRow, mapping['name']?.source_column ?? null, ' ')
  const location = resolveField(rawRow, mapping['location']?.source_column ?? null, ', ')

  return {
    name:          cleanName(name),
    email:         cleanEmail(resolveField(rawRow, mapping['email']?.source_column ?? null)),
    phone:         cleanPhone(resolveField(rawRow, mapping['phone']?.source_column ?? null)),
    team_name:     resolveField(rawRow, mapping['team_name']?.source_column ?? null).trim(),
    brokerage:     resolveField(rawRow, mapping['brokerage']?.source_column ?? null).trim(),
    website:       resolveField(rawRow, mapping['website']?.source_column ?? null).trim(),
    location:      cleanName(location),
    hs_ticket_url: hsTicketUrl,
  }
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

  const insertRows = []
  for (let i = 0; i < dataLines.length; i++) {
    const values = parseCSVLine(dataLines[i])
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue

    const rawRow: Record<string, string> = {}
    headers.forEach((h, idx) => {
      rawRow[h] = values[idx] ?? ''
    })

    insertRows.push({
      job_id: jobId,
      row_index: i,
      hs_ticket_url: hsTicketUrl,
      raw_data: rawRow,
      formatted_input: mapRowToGeneric(rawRow, columnMapping, hsTicketUrl),
    })
  }

  const BATCH_SIZE = 50
  try {
    for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
      const batch = insertRows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from('enrich_rows').insert(batch)
      if (error) throw new Error(`Batch insert failed at row ${i}: ${error.message}`)
    }

    await supabase
      .from('enrich_jobs')
      .update({
        status: 'ready',
        parsed_at: new Date().toISOString(),
        raw_row_count: insertRows.length,
      })
      .eq('id', jobId)

    // Auto-trigger the enrichment pipeline
    const appUrl = Deno.env.get('APP_URL') ?? ''
    if (appUrl) {
      fetch(`${appUrl}/api/enrich/auto-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(err => console.error('Auto-run trigger failed:', err))
    }

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
