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

  // Stage 2: Zillow profile lookup from staging.zillow_profiles
  await supabaseAdmin.rpc('ce_update_batch_pipeline', {
    p_batch_id: batch_id,
    p_stage: 'zillow_lookup',
    p_status: 'finding_websites',
  })

  for (const team of teamRows) {
    const { data: zillowUrl, error: zErr } = await supabaseAdmin.rpc('ce_find_zillow_url', {
      p_team_name: team.team_name ?? '',
    })
    if (zErr) console.error(`[zillow-lookup] ${team.team_name}: ${zErr.message}`)

    const url = (zillowUrl as string | null) ?? null
    console.log(`[zillow-lookup] ${team.team_name}: ${url || 'not found'}`)

    await supabaseAdmin.rpc('ce_update_team_zillow', {
      p_team_id: team.team_id,
      p_zillow_url: url,
      p_zillow_valid: !!url,
    })
    await supabaseAdmin.rpc('ce_update_team_pipeline_stage', {
      p_team_id: team.team_id,
      p_stage: url ? 'zillow_found' : 'zillow_not_found',
    })
  }

  // Fire verify-urls (fire-and-forget)
  const appUrl = env.NEXT_PUBLIC_APP_URL
  fetch(`${appUrl}/api/company-enrichment/verify-urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_id }),
  }).catch((err: Error) => console.error('[find-website] verify-urls trigger failed:', err.message))

  return Response.json({ data: { batch_id, processed_count: teamRows.length } })
}
