export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import type { MadEnrichRow } from '@/lib/supabase/types'

const paramsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
})

function escape(val: unknown): string {
  const s = val == null ? '' : String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildMadCSV(rows: MadEnrichRow[]): string {
  const fixedHeaders = [
    'Name', 'Email', 'Phone', 'Location', 'Company', 'Website',
  ]

  // Collect all extra_field keys in stable order from first row that has them
  const extraKeys = rows.length > 0
    ? Object.keys(rows[0].extra_fields ?? {})
    : []

  const profileHeaders = [
    'Match Type',
    'MAD Agent UUID', 'MAD Team UUID',
    'Team Name', 'Team City', 'Team State', 'Team Website',
    'Team Zillow URL', 'Brokerage Name', 'Brokerage Type',
    'Brokerage Website', 'Agent Job Title', 'Agent Domain',
    'Agent Transactions (12m)', 'Agent Email', 'Agent Phone',
  ]

  const allHeaders = [...fixedHeaders, ...extraKeys, ...profileHeaders]
  const lines: string[] = [allHeaders.map(escape).join(',')]

  for (const row of rows) {
    const p = row.mad_profile as Record<string, unknown>
    const cells = [
      escape(row.name),
      escape(row.email),
      escape(row.phone),
      escape(row.location),
      escape(row.company),
      escape(row.website),
      ...extraKeys.map(k => escape((row.extra_fields as Record<string, unknown>)[k])),
      escape(row.match_type),
      escape(p['mad_agent_uuid']),
      escape(p['mad_team_uuid']),
      escape(p['team_name']),
      escape(p['team_city']),
      escape(p['team_state']),
      escape(p['team_website']),
      escape(p['team_zillow_url']),
      escape(p['brokerage_name']),
      escape(p['brokerage_type']),
      escape(p['brokerage_website']),
      escape(p['job_title']),
      escape(p['company_domain']),
      escape(p['transactions_last_12m']),
      escape(p['email']),
      escape(p['phone']),
    ]
    lines.push(cells.join(','))
  }

  return lines.join('\n')
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid job ID' }, { status: 400 })
  }

  const { jobId } = parsed.data

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('mad_enrich_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('row_index', { ascending: true })

  if (rowsErr) return Response.json({ error: rowsErr.message }, { status: 500 })

  const csv = buildMadCSV((rows ?? []) as MadEnrichRow[])

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="mad_lookup_${jobId}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
