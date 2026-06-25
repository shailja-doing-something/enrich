import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { buildStage1CSV, buildStage2CSV } from '@/lib/csv/export'
import type { EnrichRow } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

const paramsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
})

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid job ID' }, { status: 400 })
  }

  const { jobId } = parsed.data

  const stageRaw = request.nextUrl.searchParams.get('stage')
  const stageParsed = z.enum(['1', '2']).safeParse(stageRaw)
  if (!stageParsed.success) {
    return Response.json({ error: 'Query param stage must be "1" or "2"' }, { status: 400 })
  }

  const stage = stageParsed.data

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('enrich_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('row_index', { ascending: true })

  if (rowsErr) return Response.json({ error: rowsErr.message }, { status: 500 })

  const csv = stage === '1'
    ? buildStage1CSV((rows ?? []) as EnrichRow[])
    : buildStage2CSV((rows ?? []) as EnrichRow[])

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="enrich_stage${stage}_${jobId}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
