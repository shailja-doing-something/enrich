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
  website_url: string | null
}

type VerifyResult = {
  valid: boolean
  error?: string
}

function callVerifyUrl(websiteUrl: string): Promise<VerifyResult> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'verify_urls.py')
    const proc = spawn('python3', [scriptPath], {
      env: {
        ...process.env,
        OXYLABS_USERNAME: env.OXYLABS_USERNAME,
        OXYLABS_PASSWORD: env.OXYLABS_PASSWORD,
      },
    })

    const timer = setTimeout(() => { proc.kill(); resolve({ valid: false, error: 'timeout' }) }, 60_000)

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.stdin.write(JSON.stringify({ website: websiteUrl }))
    proc.stdin.end()

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        console.error(`[verify-urls] script exited ${code}: ${stderr.trim()}`)
        resolve({ valid: false, error: stderr.trim() || 'non-zero exit' })
        return
      }
      try {
        const result = JSON.parse(stdout.trim()) as { valid?: boolean; error?: string }
        resolve({ valid: result.valid ?? false, error: result.error })
      } catch {
        resolve({ valid: false, error: 'invalid script output' })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      console.error(`[verify-urls] spawn error: ${err.message}`)
      resolve({ valid: false, error: err.message })
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
    console.error('[verify-urls] fetch teams:', teamsErr.message)
    return Response.json({ error: 'Failed to fetch teams' }, { status: 500 })
  }

  await supabaseAdmin.rpc('ce_update_batch_pipeline', {
    p_batch_id: batch_id,
    p_stage: 'verifying_urls',
    p_status: 'verifying_urls',
  })

  const teamRows = (teams ?? []) as TeamRow[]
  let verifiedCount = 0

  for (const team of teamRows) {
    if (!team.website_url) {
      // No URL to verify — still advance to verified stage so qa_processed count is accurate
      console.log(`[verify-urls] ${team.team_name}: no website, skipping verify`)
      await supabaseAdmin.rpc('ce_update_team_web_valid', {
        p_team_id: team.team_id,
        p_web_valid: false,
        p_verify_error: 'no website found',
      })
      await supabaseAdmin.rpc('ce_update_team_pipeline_stage', {
        p_team_id: team.team_id,
        p_stage: 'verified',
      })
      continue
    }

    const result = await callVerifyUrl(team.website_url)
    console.log(`[verify-urls] ${team.team_name} (${team.website_url}): valid=${result.valid}${result.error ? ` err=${result.error}` : ''}`)

    const { error } = await supabaseAdmin.rpc('ce_update_team_web_valid', {
      p_team_id: team.team_id,
      p_web_valid: result.valid,
      p_verify_error: result.error ?? null,
    })
    if (error) console.error(`[verify-urls] update web_valid for ${team.team_name}: ${error.message}`)
    else if (result.valid) verifiedCount++

    await supabaseAdmin.rpc('ce_update_team_pipeline_stage', {
      p_team_id: team.team_id,
      p_stage: 'verified',
    })
  }

  await supabaseAdmin.rpc('ce_update_batch_pipeline', {
    p_batch_id: batch_id,
    p_stage: 'verify_complete',
    p_status: 'complete',
  })

  // Fire contact enrichment for qualified teams (fire-and-forget)
  const appUrl = env.NEXT_PUBLIC_APP_URL
  fetch(`${appUrl}/api/company-enrichment/run-contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_id }),
  }).catch((err: Error) => console.error('[verify-urls] run-contacts trigger failed:', err.message))

  return Response.json({ data: { batch_id, verified_count: verifiedCount } })
}
