export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getRowsByJob } from '@/lib/supabase/rows'

const paramsSchema = z.object({
  jobId: z.string().uuid(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid job ID' }, { status: 400 })
  }

  const rows = await getRowsByJob(parsed.data.jobId)
  return Response.json({ data: rows })
}
