import type { EnrichRow } from '../supabase/types'

const WEBHOOK_URL = 'https://fello-ai.app.n8n.cloud/webhook/scrappy2'
const STATUS_BASE = 'https://team-size-webhook-production.up.railway.app/api/v1/enrich/tasks'
const POLL_INTERVAL_MS = 5000
const MAX_POLLS = 60 // 5 minutes max per row

export type TeamSizeResult = {
  row: EnrichRow
  found: boolean
  taskId: string | null
  data: Record<string, unknown> | null
}

export async function enrichTeamSize(row: EnrichRow): Promise<TeamSizeResult> {
  const fi = row.formatted_input
  if (!fi) return { row, found: false, taskId: null, data: null }

  const nameParts = (fi.name ?? '').trim().split(/\s+/)
  const firstName = nameParts[0] ?? ''
  const lastName = nameParts.slice(1).join(' ')

  const body = {
    email: fi.email,
    phone: fi.phone,
    company: fi.team_name || fi.brokerage,
    website: fi.website,
    firstname: firstName,
    lastname: lastName,
    team_name: fi.team_name,
    hs_object_id: row.hs_ticket_url,
  }

  let taskId: string | null = null
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { row, found: false, taskId: null, data: null }
    const json = await res.json() as Record<string, unknown>
    taskId = (json.task_id ?? json.taskId ?? null) as string | null
  } catch {
    return { row, found: false, taskId: null, data: null }
  }

  if (!taskId) return { row, found: false, taskId: null, data: null }

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    try {
      const res = await fetch(`${STATUS_BASE}/${taskId}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue
      const json = await res.json() as Record<string, unknown>
      if (json.ready === true && json.status === 'success') {
        const result = json.result as Record<string, unknown>
        return {
          row,
          found: true,
          taskId,
          data: {
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
            agent_designation: result.agent_designation,
            detected_crms: result.detected_crms,
            team_members: result.team_members,
          },
        }
      }
    } catch {
      // transient error — keep polling
    }
  }

  return { row, found: false, taskId, data: null }
}

export async function runBranch1(rows: EnrichRow[]): Promise<TeamSizeResult[]> {
  const results: TeamSizeResult[] = []
  for (const row of rows) {
    results.push(await enrichTeamSize(row))
  }
  return results
}
