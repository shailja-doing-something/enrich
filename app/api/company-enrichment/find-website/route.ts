import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'

const bodySchema = z.object({ batch_id: z.string().uuid() })

type TeamRow = {
  team_id: string
  team_name: string | null
  brokerage: string | null
  location: string | null
}

type OxylabsResponse = {
  results?: Array<{
    content?: {
      results?: {
        organic?: Array<{ url?: string }>
      }
    }
  }>
}

type AnthropicResponse = {
  content?: Array<{ type: string; text: string }>
}

async function searchGoogle(query: string): Promise<string[]> {
  const creds = Buffer.from(`${env.OXYLABS_USERNAME}:${env.OXYLABS_PASSWORD}`).toString('base64')
  try {
    const resp = await fetch('https://realtime.oxylabs.io/v1/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${creds}` },
      body: JSON.stringify({ source: 'google_search', query, pages: 1, limit: 5, parse: true }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!resp.ok) {
      console.error(`[find-website] Oxylabs ${resp.status}: ${await resp.text().catch(() => '')}`)
      return []
    }
    const data = await resp.json() as OxylabsResponse
    const organic = data.results?.[0]?.content?.results?.organic ?? []
    return organic.map(r => r.url).filter((u): u is string => Boolean(u))
  } catch (err) {
    console.error(`[find-website] Oxylabs SERP error: ${(err as Error).message}`)
    return []
  }
}

async function pickWithClaude(teamName: string, brokerage: string, location: string, candidates: string[]): Promise<string> {
  const candidateList = candidates.map(u => `- ${u}`).join('\n')
  const prompt = `Real estate team: ${teamName}\nBrokerage: ${brokerage}\nLocation: ${location}\n\nWhich of these URLs is the team's official website?\n${candidateList}\n\nReply with ONLY the URL, or "none" if none match.`
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!resp.ok) {
      console.error(`[find-website] Anthropic ${resp.status}: ${await resp.text().catch(() => '')}`)
      return candidates[0] ?? ''
    }
    const data = await resp.json() as AnthropicResponse
    const answer = (data.content?.[0]?.text ?? '').trim()
    if (answer.toLowerCase() === 'none') return ''
    const urls = answer.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) ?? []
    return urls[0]?.replace(/[.,)]+$/, '') ?? ''
  } catch (err) {
    console.error(`[find-website] Anthropic error: ${(err as Error).message}`)
    return candidates[0] ?? ''
  }
}

async function callFindWebsite(team: TeamRow): Promise<string> {
  if (!team.team_name) return ''
  const query = `"${team.team_name}" ${team.brokerage ?? ''} ${team.location ?? ''} real estate team`
  const candidates = await searchGoogle(query)
  if (candidates.length === 0) return ''
  if (candidates.length === 1) return candidates[0]
  return pickWithClaude(team.team_name, team.brokerage ?? '', team.location ?? '', candidates.slice(0, 5))
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

  const { data: teams, error: teamsErr } = await supabaseAdmin.rpc('ce_get_batch_teams', {
    p_batch_id: batch_id,
  })
  if (teamsErr) {
    console.error('[find-website] fetch teams:', teamsErr.message)
    return Response.json({ error: 'Failed to fetch teams' }, { status: 500 })
  }

  await supabaseAdmin.rpc('ce_update_batch_pipeline', {
    p_batch_id: batch_id,
    p_stage: 'finding_websites',
    p_status: 'finding_websites',
  })

  const teamRows = (teams ?? []) as TeamRow[]

  // Stage 1: website finder
  for (const team of teamRows) {
    const website = await callFindWebsite(team)
    if (website) {
      const { error } = await supabaseAdmin.rpc('ce_update_team_website', {
        p_team_id: team.team_id,
        p_website_url: website,
      })
      if (error) console.error(`[find-website] update website for ${team.team_name}: ${error.message}`)
    }
    await supabaseAdmin.rpc('ce_update_team_pipeline_stage', {
      p_team_id: team.team_id,
      p_stage: website ? 'website_found' : 'website_not_found',
    })
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL

  // Stage 2: Zillow profile lookup via live API (falls back to DB on network error)
  await supabaseAdmin.rpc('ce_update_batch_pipeline', {
    p_batch_id: batch_id,
    p_stage: 'zillow_lookup',
    p_status: 'finding_websites',
  })

  for (const team of teamRows) {
    let zillowUrl: string | null = null

    try {
      const resp = await fetch(`${appUrl}/api/company-enrichment/find-zillow-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_name: team.team_name ?? '',
          location: team.location ?? '',
          brokerage: team.brokerage ?? '',
        }),
        signal: AbortSignal.timeout(20_000),
      })
      if (resp.ok) {
        const json = (await resp.json()) as { data: { zillow_url: string | null; reason?: string } }
        if (json.data.reason === 'network_error') {
          // Live API unavailable — fall back to DB
          const { data: dbUrl, error: dbErr } = await supabaseAdmin.rpc('ce_find_zillow_url', {
            p_team_name: team.team_name ?? '',
          })
          if (dbErr) console.error(`[zillow-lookup] DB fallback ${team.team_name}: ${dbErr.message}`)
          zillowUrl = (dbUrl as string | null) ?? null
          console.log(`[zillow-lookup] ${team.team_name}: DB fallback → ${zillowUrl || 'not found'}`)
        } else {
          zillowUrl = json.data.zillow_url ?? null
          console.log(`[zillow-lookup] ${team.team_name}: ${zillowUrl || 'not found'}`)
        }
      } else {
        console.error(`[zillow-lookup] ${team.team_name}: find-zillow-url returned ${resp.status}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[zillow-lookup] ${team.team_name}: fetch error: ${msg}`)
      // Network failure — fall back to DB
      const { data: dbUrl, error: dbErr } = await supabaseAdmin.rpc('ce_find_zillow_url', {
        p_team_name: team.team_name ?? '',
      })
      if (dbErr) console.error(`[zillow-lookup] DB fallback ${team.team_name}: ${dbErr.message}`)
      zillowUrl = (dbUrl as string | null) ?? null
      console.log(`[zillow-lookup] ${team.team_name}: DB fallback → ${zillowUrl || 'not found'}`)
    }

    await supabaseAdmin.rpc('ce_update_team_zillow', {
      p_team_id: team.team_id,
      p_zillow_url: zillowUrl,
      p_zillow_valid: !!zillowUrl,
    })
    await supabaseAdmin.rpc('ce_update_team_pipeline_stage', {
      p_team_id: team.team_id,
      p_stage: zillowUrl ? 'zillow_found' : 'zillow_not_found',
    })
  }

  // Fire verify-urls (fire-and-forget)
  fetch(`${appUrl}/api/company-enrichment/verify-urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_id }),
  }).catch((err: Error) => console.error('[find-website] verify-urls trigger failed:', err.message))

  return Response.json({ data: { batch_id, processed_count: teamRows.length } })
}
