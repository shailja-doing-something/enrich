import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'
import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'
import type { EnrichRow } from '@/lib/supabase/types'

const bodySchema = z.object({
  jobId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { jobId } = parsed.data
  const appUrl = env.NEXT_PUBLIC_APP_URL

  const { data: rowsData, error: rowsErr } = await supabaseAdmin
    .from('enrich_rows')
    .select('*')
    .eq('job_id', jobId)
    .eq('branch1_status', 'pending')
    .order('row_index', { ascending: true })

  if (rowsErr) {
    return Response.json({ error: rowsErr.message }, { status: 500 })
  }

  const rows = (rowsData ?? []) as EnrichRow[]

  if (rows.length === 0) {
    return Response.json({ message: 'No rows to process' })
  }

  await updateJob(jobId, { branch1_status: 'running' })

  let found = 0
  for (const row of rows) {
    try {
      const res = await fetch(`${appUrl}/api/enrich/team-size-process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, rowId: row.id }),
      })
      const data = await res.json() as { found?: boolean }
      if (data.found) found++
    } catch (e) {
      console.error('Row failed:', row.id, e)
    }
  }

  await updateJob(jobId, {
    branch1_status: 'complete',
    branch1_completed_at: new Date().toISOString(),
    branch1_found_count: found,
  })

  // If branch2 is also complete, trigger merge
  const job = await getJob(jobId)
  if (job?.branch2_status === 'complete') {
    fetch(`${appUrl}/api/enrich/merge-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(err => console.error('merge-results trigger failed:', err))
  }

  return Response.json({ processed: rows.length, found })
}
