import { NextRequest } from 'next/server'
import { z } from 'zod'
import Papa from 'papaparse'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ batch_id: z.string().uuid() })

export async function GET(
  _request: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid batch_id' }, { status: 400 })
  }
  const { batch_id } = parsed.data

  const { data, error } = await supabaseAdmin.rpc('ce_get_batch_agents', {
    p_batch_id: batch_id,
  })
  if (error) {
    console.error(error.message)
    return Response.json({ error: 'Failed to fetch contacts' }, { status: 500 })
  }

  type AgentRow = {
    agent_id: string
    team_id: string
    team_name: string | null
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
    designation: string | null
    source: string | null
  }

  const rows = ((data ?? []) as AgentRow[]).map(a => ({
    'First Name': a.first_name ?? '',
    'Last Name': a.last_name ?? '',
    'Email': a.email ?? '',
    'Phone': a.phone ?? '',
    'Job Title': a.designation ?? '',
    'Team Name': a.team_name ?? '',
    'Source': a.source ?? '',
  }))

  const csv = Papa.unparse(rows)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="contacts-${batch_id}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
