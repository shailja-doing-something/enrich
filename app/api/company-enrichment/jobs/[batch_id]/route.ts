import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ batch_id: z.string().uuid() })


type ContactStage = 'pending' | 'running' | 'done' | 'failed'

function deriveContactStage(currentStage: string | null): ContactStage {
  if (currentStage === 'contacts_running') return 'running'
  if (currentStage === 'contacts_done') return 'done'
  if (currentStage === 'contacts_failed') return 'failed'
  return 'pending'
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

  const { data: teams, error: teamsErr } = await supabaseAdmin.rpc('ce_get_batch_teams', {
    p_batch_id: batch_id,
  })
  if (teamsErr) {
    console.error(teamsErr.message)
    return Response.json({ error: 'Failed to fetch teams' }, { status: 500 })
  }

  const { data: batchRows, error: batchErr } = await supabaseAdmin.rpc('ce_get_batch_info', {
    p_batch_id: batch_id,
  })
  if (batchErr) {
    console.error(batchErr.message)
    return Response.json({ error: 'Failed to fetch batch info' }, { status: 500 })
  }

  const batchInfo = Array.isArray(batchRows) ? batchRows[0] : null
  const currentStage = (batchInfo as { current_stage?: string | null } | null)?.current_stage ?? null
  const contactsCount = (batchInfo as { contacts_count?: number | null } | null)?.contacts_count ?? 0

  return Response.json({
    data: {
      teams: teams ?? [],
      contacts_count: Number(contactsCount),
      contact_stage: deriveContactStage(currentStage),
    },
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid batch_id' }, { status: 400 })
  }
  const { batch_id } = parsed.data

  const { error } = await supabaseAdmin.rpc('ce_delete_batch', { p_batch_id: batch_id })
  if (error) {
    console.error('[delete-batch]', error.message)
    return Response.json({ error: 'Failed to delete batch' }, { status: 500 })
  }

  return Response.json({ data: { deleted: true } }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
