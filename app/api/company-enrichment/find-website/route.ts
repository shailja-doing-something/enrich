import { NextRequest } from 'next/server'
import { z } from 'zod'
import { spawn } from 'child_process'
import path from 'path'
import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'

const bodySchema = z.object({ batch_id: z.string().uuid() })

type TeamRow = {
  team_id: string
  team_name: string | null
  brokerage: string | null
  location: string | null
}

function callFindWebsite(team: TeamRow): Promise<string> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'find_website.py')
    const proc = spawn('python3', [scriptPath], {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        OXYLABS_USERNAME: env.OXYLABS_USERNAME,
        OXYLABS_PASSWORD: env.OXYLABS_PASSWORD,
      },
    })

    const timer = setTimeout(() => { proc.kill(); resolve('') }, 60_000)

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.stdin.write(JSON.stringify({
      team_name: team.team_name ?? '',
      brokerage: team.brokerage ?? '',
      location: team.location ?? '',
    }))
    proc.stdin.end()

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (stderr.trim()) {
        console.error(`[find-website] ${team.team_name} stderr: ${stderr.trim()}`)
      }
      if (code !== 0) {
        console.error(`[find-website] ${team.team_name}: script exited ${code}`)
        resolve('')
        return
      }
      try {
        const result = JSON.parse(stdout.trim()) as { website?: string }
        const website = result.website ?? ''
        console.log(`[find-website] ${team.team_name}: ${website || 'not found'}`)
        resolve(website)
      } catch {
        console.error(`[find-website] ${team.team_name}: invalid script output: ${stdout.trim()}`)
        resolve('')
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      console.error(`[find-website] ${team.team_name}: spawn error: ${err.message}`)
      resolve('')
    })
  })
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
