import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'

const bodySchema = z.object({ batch_id: z.string().uuid() })

type QualifiedTeam = {
  team_id: string
  team_name: string | null
  website_url: string | null
  zillow_url: string | null
  web_valid: boolean | null
  zillow_valid: boolean | null
}

type AgentInsertRow = {
  batch_id: string
  team_id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  designation: string
  source: string
}

type ScrapeResponse = {
  markdown?: string
  pages_scraped?: number
  failed_urls?: string[]
}

type ExtractResponse = {
  agents_data?: Array<{
    name?: string
    email?: string[]
    phone?: string[]
    designation?: string
  }>
  has_contacts?: boolean
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function normalizeUrl(url: string): string {
  if (!url) return ''
  return url.startsWith('http') ? url : `https://${url}`
}

async function scrapeUrlForAgents(
  batchId: string,
  teamId: string,
  teamName: string,
  url: string,
  source: 'web' | 'zillow'
): Promise<AgentInsertRow[]> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const functionSecret = env.FUNCTION_SECRET
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${anonKey}`,
    'x-function-secret': functionSecret,
  }

  const normalizedUrl = normalizeUrl(url)
  if (!normalizedUrl) return []

  let markdown = ''
  try {
    const scrapeResp = await fetch(`${supabaseUrl}/functions/v1/scrape-urls-combined`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ team_uuid: teamId, team_name: teamName, urls: [normalizedUrl] }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!scrapeResp.ok) {
      const text = await scrapeResp.text().catch(() => '')
      console.error(`[run-contacts] scrape-urls-combined ${scrapeResp.status} for ${teamName} (${source}): ${text.slice(0, 200)}`)
      return []
    }
    const scrapeData = await scrapeResp.json() as ScrapeResponse
    markdown = scrapeData.markdown ?? ''
    console.log(`[run-contacts] scraped ${teamName} (${source}): pages=${scrapeData.pages_scraped}, len=${markdown.length}, failed=${JSON.stringify(scrapeData.failed_urls ?? [])}`)
  } catch (err) {
    console.error(`[run-contacts] scrape error ${teamName} (${source}): ${(err as Error).message}`)
    return []
  }

  if (!markdown) {
    console.log(`[run-contacts] ${teamName} (${source}): empty markdown, skipping extract`)
    return []
  }

  try {
    const extractResp = await fetch(`${supabaseUrl}/functions/v1/extract-team-data`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ team_uuid: teamId, team_name: teamName, markdown }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!extractResp.ok) {
      const text = await extractResp.text().catch(() => '')
      console.error(`[run-contacts] extract-team-data ${extractResp.status} for ${teamName} (${source}): ${text.slice(0, 200)}`)
      return []
    }
    const extractData = await extractResp.json() as ExtractResponse
    const agentsData = extractData.agents_data ?? []
    console.log(`[run-contacts] extracted ${teamName} (${source}): ${agentsData.length} agents, has_contacts=${extractData.has_contacts}`)

    return agentsData
      .filter(a => (a.name ?? '').trim() !== '' || (a.email ?? []).length > 0)
      .map(a => {
        const { firstName, lastName } = splitName(a.name ?? '')
        return {
          batch_id: batchId,
          team_id: teamId,
          first_name: firstName,
          last_name: lastName,
          email: (a.email ?? []).join('; ').trim(),
          phone: (a.phone ?? []).join('; ').trim(),
          designation: a.designation ?? '',
          source,
        }
      })
  } catch (err) {
    console.error(`[run-contacts] extract error ${teamName} (${source}): ${(err as Error).message}`)
    return []
  }
}

function mergeAgents(webAgents: AgentInsertRow[], zillowAgents: AgentInsertRow[]): AgentInsertRow[] {
  // Email-keyed dedup: zillow wins on conflict, mark source 'zillow;web' if both have it
  const byEmail = new Map<string, AgentInsertRow>()
  for (const agent of webAgents) {
    const key = agent.email.toLowerCase().trim()
    if (key) byEmail.set(key, agent)
  }
  for (const agent of zillowAgents) {
    const key = agent.email.toLowerCase().trim()
    if (key) {
      const existing = byEmail.get(key)
      byEmail.set(key, { ...agent, source: existing ? 'zillow;web' : 'zillow' })
    }
  }

  // Name-keyed dedup for agents without email: merge phone/designation across sources
  const byName = new Map<string, AgentInsertRow>()
  const unnamed: AgentInsertRow[] = []

  for (const agent of [...webAgents, ...zillowAgents]) {
    if (agent.email.trim()) continue  // handled above
    const nameKey = `${agent.first_name.toLowerCase().trim()}|${agent.last_name.toLowerCase().trim()}`
    if (!agent.first_name.trim() && !agent.last_name.trim()) {
      unnamed.push(agent)
      continue
    }
    const existing = byName.get(nameKey)
    if (!existing) {
      byName.set(nameKey, agent)
    } else {
      // Same name on both sources — merge: prefer whichever has phone/designation, mark both
      byName.set(nameKey, {
        ...existing,
        phone: existing.phone || agent.phone,
        designation: existing.designation || agent.designation,
        source: existing.source !== agent.source ? `${existing.source};${agent.source}` : existing.source,
      })
    }
  }

  return Array.from(byEmail.values()).concat(Array.from(byName.values()), unnamed)
}

async function enrichTeam(team: QualifiedTeam, batchId: string): Promise<AgentInsertRow[]> {
  const [webAgents, zillowAgents] = await Promise.all([
    (team.web_valid && team.website_url)
      ? scrapeUrlForAgents(batchId, team.team_id, team.team_name ?? '', team.website_url, 'web')
      : Promise.resolve<AgentInsertRow[]>([]),
    (team.zillow_valid && team.zillow_url)
      ? scrapeUrlForAgents(batchId, team.team_id, team.team_name ?? '', team.zillow_url, 'zillow')
      : Promise.resolve<AgentInsertRow[]>([]),
  ])

  const merged = mergeAgents(webAgents, zillowAgents)
  console.log(`[run-contacts] ${team.team_name}: web=${webAgents.length} zillow=${zillowAgents.length} merged=${merged.length}`)
  return merged
}

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }
  const { batch_id } = parsed.data

  const { data: teams, error: teamsErr } = await supabaseAdmin.rpc('ce_get_qualified_teams', {
    p_batch_id: batch_id,
  })
  if (teamsErr) {
    console.error('[run-contacts] fetch qualified teams:', teamsErr.message)
    return Response.json({ error: 'Failed to fetch teams' }, { status: 500 })
  }

  await supabaseAdmin.rpc('ce_skip_unqualified_teams', { p_batch_id: batch_id })

  const qualifiedTeams = (teams ?? []) as QualifiedTeam[]
  if (qualifiedTeams.length === 0) {
    await supabaseAdmin.rpc('ce_update_batch_pipeline', {
      p_batch_id: batch_id,
      p_stage: 'contacts_done',
      p_status: 'complete',
    })
    return Response.json({ data: { batch_id, processed: 0, agents_written: 0 } })
  }

  await supabaseAdmin.rpc('ce_update_batch_pipeline', {
    p_batch_id: batch_id,
    p_stage: 'contacts_running',
    p_status: 'enriching_contacts',
  })

  let hasError = false
  let totalAgentsWritten = 0
  const debugErrors: string[] = []

  for (const team of qualifiedTeams) {
    console.log(`[run-contacts] processing ${team.team_name} (${team.team_id}) web_valid=${team.web_valid} zillow_valid=${team.zillow_valid}`)
    try {
      const agents = await enrichTeam(team, batch_id)
      console.log(`[run-contacts] ${team.team_name}: ${agents.length} agents to insert`)

      if (agents.length > 0) {
        const { data: insertedCount, error: insertErr } = await supabaseAdmin.rpc('ce_insert_agents_bulk', {
          p_agents: agents,
        })
        if (insertErr) {
          throw new Error(`Agent insert failed: ${insertErr.message}`)
        }
        const actualInserted = (insertedCount as number) ?? 0
        console.log(`[run-contacts] ${team.team_name}: inserted ${actualInserted}/${agents.length} agents`)
        totalAgentsWritten += actualInserted
      }

      const { error: stageErr } = await supabaseAdmin.rpc('ce_update_team_pipeline_stage', {
        p_team_id: team.team_id,
        p_stage: 'contacts_done',
      })
      if (stageErr) {
        const msg = `stage update failed for ${team.team_name}: ${stageErr.message}`
        console.error(`[run-contacts] ${msg}`)
        debugErrors.push(msg)
        hasError = true
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[run-contacts] team ${team.team_name} failed: ${msg}`)
      debugErrors.push(`${team.team_name}: ${msg}`)
      hasError = true
      await supabaseAdmin.rpc('ce_update_batch_pipeline', {
        p_batch_id: batch_id,
        p_stage: 'contacts_failed',
        p_status: 'enriching_contacts',
      })
      const { error: failStageErr } = await supabaseAdmin.rpc('ce_update_team_pipeline_stage', {
        p_team_id: team.team_id,
        p_stage: 'contacts_failed',
      })
      if (failStageErr) console.error(`[run-contacts] fail-stage update error for ${team.team_name}: ${failStageErr.message}`)
    }
  }

  const finalStage = hasError ? 'contacts_failed' : 'contacts_done'
  await supabaseAdmin.rpc('ce_update_batch_pipeline', {
    p_batch_id: batch_id,
    p_stage: finalStage,
    p_status: 'complete',
  })

  return Response.json({ data: { batch_id, processed: qualifiedTeams.length, agents_written: totalAgentsWritten, has_error: hasError, errors: debugErrors } })
}
