import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ batch_id: z.string().uuid() })

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
  created_at: string | null
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

  const { data, error } = await supabaseAdmin.rpc('ce_get_batch_agents', {
    p_batch_id: batch_id,
  })
  if (error) {
    console.error(error.message)
    return Response.json({ error: 'Failed to fetch contacts' }, { status: 500 })
  }

  const agents = (data ?? []) as AgentRow[]

  // Group by team_name
  const grouped: Record<string, AgentRow[]> = {}
  for (const agent of agents) {
    const key = agent.team_name ?? 'Unknown'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(agent)
  }

  return Response.json({ data: { agents, grouped } }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
