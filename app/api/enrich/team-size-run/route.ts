import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getJob, updateJob } from '@/lib/supabase/jobs'
import { supabaseAdmin } from '@/lib/supabase/client'
import type { EnrichRow } from '@/lib/supabase/types'

const ASYNC_URL = 'https://team-size-webhook-production.up.railway.app/api/v1/enrich/async'
const STATUS_BASE = 'https://team-size-webhook-production.up.railway.app/api/v1/enrich/tasks'

const bodySchema = z.object({
  jobId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { jobId } = parsed.data

  try {
    // Guard: don't re-run if already complete or running
    const job = await getJob(jobId)
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.branch1_status === 'complete') {
      return Response.json({ message: 'Branch 1 already complete' })
    }
    if (job.branch1_status === 'running') {
      return Response.json({ message: 'Branch 1 already running' })
    }

    await updateJob(jobId, { branch1_status: 'running' })

    const { data: rowsData, error: rowsErr } = await supabaseAdmin
      .from('enrich_rows')
      .select('*')
      .eq('job_id', jobId)
      .eq('branch1_status', 'pending')
      .order('row_index', { ascending: true })

    if (rowsErr) {
      await updateJob(jobId, { branch1_status: 'failed' })
      return Response.json({ error: rowsErr.message }, { status: 500 })
    }

    const rows = (rowsData ?? []) as EnrichRow[]

    console.log('[TeamSize] Rows to process:', rows.length)

    if (rows.length === 0) {
      await updateJob(jobId, {
        branch1_status: 'complete',
        branch1_completed_at: new Date().toISOString(),
        branch1_found_count: 0,
      })
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://enrich-production-1129.up.railway.app'
      fetch(`${appUrl}/api/enrich/check-completion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(console.error)
      return Response.json({ processed: 0, found: 0 })
    }

    // ── PHASE 1: Submit all rows simultaneously ───────────────────────────────

    const submissions = await Promise.all(
      rows.map(async (row) => {
        const fi = row.formatted_input
        const nameParts = (fi?.name ?? '').trim().split(/\s+/)
        const firstName = nameParts[0] ?? ''
        const lastName = nameParts.slice(1).join(' ')

        try {
          const res = await fetch(`${ASYNC_URL}?priority=false`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              list_name: `${firstName} ${lastName}`.trim(),
              list_email: fi?.email ?? '',
              list_phone: String(fi?.phone ?? ''),
              list_team_name: fi?.team_name || fi?.brokerage || '',
              list_website: fi?.website || '',
              list_location: 'na',
            }),
            signal: AbortSignal.timeout(30000),
          })

          if (!res.ok) {
            console.error('[TeamSize] Submit failed for:', fi?.email, res.status)
            return { rowId: row.id, taskId: null, email: fi?.email }
          }

          const rawBody = await res.text()
          console.log('[TeamSize] Submit response for', fi?.email, ':', rawBody)
          const json = JSON.parse(rawBody) as Record<string, unknown>
          const taskId = (json.task_id ?? json.taskId ?? json.id ?? null) as string | null
          console.log('[TeamSize] taskId for', fi?.email, ':', taskId)
          return { rowId: row.id, taskId, email: fi?.email }
        } catch (e) {
          console.error('[TeamSize] Submit error for:', fi?.email, String(e))
          return { rowId: row.id, taskId: null as string | null, email: fi?.email }
        }
      })
    )

    const withTask = submissions.filter(s => s.taskId !== null)
    const withoutTask = submissions.filter(s => s.taskId === null)

    for (const s of withoutTask) {
      await supabaseAdmin
        .from('enrich_rows')
        .update({ branch1_status: 'not_found' })
        .eq('id', s.rowId)
    }

    console.log('[TeamSize] Submitted:', withTask.length, 'tasks. No task_id:', withoutTask.length)

    // ── PHASE 2: Poll all task_ids in parallel ────────────────────────────────

    const MAX_POLLS = 40
    const POLL_INTERVAL = 5000

    const completed = new Set<string>()
    let polls = 0
    let foundCount = 0

    while (completed.size < withTask.length && polls < MAX_POLLS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      polls++

      const pending = withTask.filter(s => !completed.has(s.rowId))

      await Promise.all(pending.map(async (s) => {
        try {
          const res = await fetch(`${STATUS_BASE}/${s.taskId}`, {
            signal: AbortSignal.timeout(10000),
          })
          if (!res.ok) return

          const data = await res.json() as Record<string, unknown>

          if (data.ready === true && data.status === 'success') {
            completed.add(s.rowId)
            const result = data.result as Record<string, unknown>

            await supabaseAdmin
              .from('enrich_rows')
              .update({
                team_size_data: {
                  source: 'team_size_webhook',
                  task_id: s.taskId,
                  fetched_at: new Date().toISOString(),
                  team_size_count: result.team_size_count,
                  team_size_category: result.team_size_category,
                  team_name: result.team_name,
                  brokerage_name: result.brokerage_name,
                  homepage_url: result.homepage_url,
                  team_page_url: result.team_page_url,
                  confidence: result.confidence,
                  reasoning: result.reasoning,
                  agent_id: result.agent_id,
                  team_members: result.team_members,
                  detected_crms: result.detected_crms,
                },
                branch1_status: 'found',
              })
              .eq('id', s.rowId)

            foundCount++
            console.log('[TeamSize] Found:', s.email, 'poll:', polls, 'total found:', foundCount)
          } else if (data.status === 'failed' || data.error_code !== null) {
            completed.add(s.rowId)
            await supabaseAdmin
              .from('enrich_rows')
              .update({ branch1_status: 'not_found' })
              .eq('id', s.rowId)
            console.log('[TeamSize] Failed task for:', s.email)
          }
        } catch (e) {
          console.error('[TeamSize] Poll error for:', s.email, String(e))
        }
      }))

      console.log('[TeamSize] Poll', polls, '- completed:', completed.size, '/', withTask.length)
    }

    // Mark any remaining as not_found (timed out)
    const timedOut = withTask.filter(s => !completed.has(s.rowId))
    for (const s of timedOut) {
      await supabaseAdmin
        .from('enrich_rows')
        .update({ branch1_status: 'not_found' })
        .eq('id', s.rowId)
      console.log('[TeamSize] Timeout for:', s.email)
    }

    // ── Finalize ──────────────────────────────────────────────────────────────

    await updateJob(jobId, {
      branch1_status: 'complete',
      branch1_completed_at: new Date().toISOString(),
      branch1_found_count: foundCount,
    })

    console.log('[TeamSize] Branch 1 complete. Found:', foundCount, '/', rows.length)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://enrich-production-1129.up.railway.app'
    fetch(`${appUrl}/api/enrich/check-completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(console.error)

    return Response.json({ processed: rows.length, found: foundCount })
  } catch (e) {
    console.error('[TeamSize] Branch 1 fatal error:', String(e))
    await updateJob(jobId, { branch1_status: 'failed' })
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
