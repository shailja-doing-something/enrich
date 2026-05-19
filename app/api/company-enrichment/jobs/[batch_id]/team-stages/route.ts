import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

  const { data, error } = await supabaseAdmin.rpc('ce_get_team_stages', { p_batch_id: batch_id })
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ data })
}
