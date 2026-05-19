import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const { data, error } = await supabaseAdmin.rpc('ce_count_enriched_teams')
  if (error) {
    console.error('[teams-enriched]', error.message)
    return Response.json({ error: 'Failed to fetch count' }, { status: 500 })
  }
  return Response.json({ data: { count: Number(data ?? 0) } })
}
