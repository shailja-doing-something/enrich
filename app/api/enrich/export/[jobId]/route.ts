import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { buildStage1CSV } from '@/lib/csv/export'
import type { EnrichRow } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

const paramsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
})

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
    .from('enrich_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('row_index', { ascending: true })

  if (rowsErr) return Response.json({ error: rowsErr.message }, { status: 500 })

  const csv = buildStage1CSV((rows ?? []) as EnrichRow[])

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="enrich_${jobId}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
