import { NextRequest } from 'next/server'
import { z } from 'zod'
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

  const { data, error } = await supabaseAdmin.rpc('ce_get_batch_teams', {
    p_batch_id: batch_id,
  })
  if (error) {
    console.error(error.message)
    return Response.json({ error: 'Failed to fetch teams' }, { status: 500 })
  }
  return Response.json({ data }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
