import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

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

  const { data: rows, error } = await supabaseAdmin.rpc('ce_get_batch_detail', {
    p_batch_id: batch_id,
  })
  if (error) {
    console.error('[batch-detail]', error.message)
    return Response.json({ error: 'Failed to fetch batch detail' }, { status: 500 })
  }

  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) {
    return Response.json({ error: 'Batch not found' }, { status: 404 })
  }

  return Response.json({ data: row }, {
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
