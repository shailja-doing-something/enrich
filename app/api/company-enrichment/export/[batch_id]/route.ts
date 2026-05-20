import { NextRequest } from 'next/server'
import { z } from 'zod'
import Papa from 'papaparse'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ batch_id: z.string().uuid() })

type ExportRow = {
  mad_id: string | null
  team_name: string | null
  brokerage: string | null
  location: string | null
  website_url: string | null
  web_valid: boolean | null
  zillow_url: string | null
  zillow_valid: boolean | null
  verify_error: string | null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid batch_id' }, { status: 400 })
  }
  const { batch_id } = parsed.data

  const { data, error } = await supabaseAdmin.rpc('ce_export_batch_teams', {
    p_batch_id: batch_id,
  })
  if (error) {
    console.error(error.message)
    return Response.json({ error: 'Failed to fetch teams' }, { status: 500 })
  }

  const rows = (data ?? []) as ExportRow[]
  const csvRows = rows.map(r => ({
    MAD_ID: r.mad_id ?? '',
    team_name: r.team_name ?? '',
    brokerage: r.brokerage ?? '',
    location: r.location ?? '',
    website_url: r.website_url ?? '',
    web_valid: r.web_valid === null ? '' : String(r.web_valid),
    zillow_url: r.zillow_url ?? '',
    zillow_valid: r.zillow_valid === null ? '' : String(r.zillow_valid),
    verify_error: r.verify_error ?? '',
  }))

  const csv = Papa.unparse({
    fields: ['MAD_ID', 'team_name', 'brokerage', 'location', 'website_url', 'web_valid', 'zillow_url', 'zillow_valid', 'verify_error'],
    data: csvRows,
  })

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="company-enrichment-${batch_id}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
