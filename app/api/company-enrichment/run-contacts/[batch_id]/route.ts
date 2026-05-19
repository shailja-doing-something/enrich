import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'

const paramsSchema = z.object({ batch_id: z.string().uuid() })

export async function POST(
  _request: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid batch_id' }, { status: 400 })
  }
  const { batch_id } = parsed.data

  // Set stage synchronously so the UI immediately reflects running state
  const { error: stageErr } = await supabaseAdmin.rpc('ce_update_batch_pipeline', {
    p_batch_id: batch_id,
    p_stage: 'contacts_running',
    p_status: 'enriching_contacts',
  })
  if (stageErr) {
    console.error('[run-contacts-trigger]', stageErr.message)
    return Response.json({ error: 'Failed to start contact enrichment' }, { status: 500 })
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL
  fetch(`${appUrl}/api/company-enrichment/run-contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_id }),
  }).catch((err: Error) => console.error('[run-contacts-trigger] fire failed:', err.message))

  return Response.json({ data: { status: 'started' } })
}
