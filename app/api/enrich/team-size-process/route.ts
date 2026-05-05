import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { updateRow } from '@/lib/supabase/rows'
import type { EnrichRow } from '@/lib/supabase/types'

const WEBHOOK_URL = 'https://fello-ai.app.n8n.cloud/webhook/scrappy2'
const STATUS_BASE = 'https://team-size-webhook-production.up.railway.app/api/v1/enrich/tasks'

const bodySchema = z.object({
  jobId: z.string().uuid(),
  rowId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { rowId } = parsed.data

  const { data: rowData, error: rowErr } = await supabaseAdmin
    .from('enrich_rows')
    .select('*')
    .eq('id', rowId)
    .maybeSingle()

  if (rowErr || !rowData) {
    return Response.json({ error: 'Row not found' }, { status: 404 })
  }

  const row = rowData as EnrichRow
  const fi = row.formatted_input

  console.log('[TeamSize] Processing row:', rowId, 'email:', fi?.email ?? 'none')

  const nameParts = (fi?.name ?? '').trim().split(/\s+/)
  const firstName = nameParts[0] ?? ''
  const lastName = nameParts.slice(1).join(' ')

  let taskId: string | null = null
  try {
    console.log('[TeamSize] Calling webhook for:', fi?.email)
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: fi?.email ?? '',
        phone: fi?.phone ?? '',
        company: fi?.team_name || fi?.brokerage || '',
        website: fi?.website || '',
        firstname: firstName,
        lastname: lastName,
        team_name: fi?.team_name || '',
        hs_object_id: row.hs_ticket_url || '',
      }),
      signal: AbortSignal.timeout(30000),
    })
    console.log('[TeamSize] Webhook response:', res.status)
    const rawBody = await res.text()
    console.log('[TeamSize] Webhook raw response body:', rawBody)

    if (!res.ok) {
      console.error('[TeamSize] Webhook error body:', rawBody)
      console.error('[TeamSize] Webhook rejected:', res.status, rawBody)
      await updateRow(rowId, { branch1_status: 'failed' })
      return Response.json({ found: false, reason: 'webhook_error', status: res.status, body: rawBody })
    }

    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      console.error('[TeamSize] Response is not JSON')
      await updateRow(rowId, { branch1_status: 'failed' })
      return Response.json({ found: false, reason: 'invalid_json' })
    }

    console.log('[TeamSize] Parsed response keys:', Object.keys(json))
    taskId = (json.task_id ?? json.taskId ?? json.id ?? json.taskID ?? null) as string | null
    console.log('[TeamSize] Extracted taskId:', taskId)
  } catch (e) {
    console.error('[TeamSize] Webhook call failed:', String(e))
    await updateRow(rowId, { branch1_status: 'failed' })
    return Response.json({ found: false, reason: 'webhook_exception', error: String(e) })
  }

  if (!taskId) {
    await updateRow(rowId, { branch1_status: 'not_found' })
    return Response.json({ found: false, reason: 'no_task_id' })
  }

  console.log('[TeamSize] taskId:', taskId)
  console.log('[TeamSize] Got taskId:', taskId, 'for email:', fi?.email)

  let polls = 0
  let result: Record<string, unknown> | null = null
  while (polls < 36) {
    await new Promise(r => setTimeout(r, 5000))
    try {
      const statusRes = await fetch(`${STATUS_BASE}/${taskId}`, {
        signal: AbortSignal.timeout(10000),
      })
      const statusData = await statusRes.json() as Record<string, unknown>
      if (polls % 5 === 0) {
        console.log('[TeamSize] Still polling task:', taskId, 'poll:', polls)
      }
      console.log('[TeamSize] Poll', polls, 'for task:', taskId, 'status:', statusData.status, 'ready:', statusData.ready)
      if (statusData.ready === true && statusData.status === 'success') {
        result = statusData.result as Record<string, unknown>
        break
      }
    } catch {
      // transient — keep polling
    }
    polls++
  }

  if (result) {
    console.log('[TeamSize] FOUND result for:', fi?.email, 'team_size_count:', result.team_size_count)
    await updateRow(rowId, {
      team_size_data: {
        source: 'team_size_webhook',
        task_id: taskId,
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
    return Response.json({ found: true })
  }

  console.log('[TeamSize] TIMEOUT for:', fi?.email, 'task:', taskId)
  await updateRow(rowId, { branch1_status: 'not_found' })
  return Response.json({ found: false, reason: 'timeout' })
}
