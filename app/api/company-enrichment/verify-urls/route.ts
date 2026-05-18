import { NextRequest } from 'next/server'
import { z } from 'zod'
import { spawn } from 'child_process'
import path from 'path'
import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'

const bodySchema = z.object({ batch_id: z.string().uuid() })

type TeamRow = {
  id: string
  website: string | null
}

function callVerifyUrl(website: string): Promise<string> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'verify_urls.py')
    const proc = spawn('python3', [scriptPath], {
      env: {
        ...process.env,
        OXYLABS_USERNAME: env.OXYLABS_USERNAME,
        OXYLABS_PASSWORD: env.OXYLABS_PASSWORD,
      },
    })

    const timer = setTimeout(() => {
      proc.kill()
      resolve('')
    }, 60_000)

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.stdin.write(JSON.stringify({ website }))
    proc.stdin.end()

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        console.error(`verify_urls.py exited ${code}: ${stderr.trim()}`)
        resolve('')
        return
      }
      try {
        const result = JSON.parse(stdout.trim()) as { verified_url?: string }
        resolve(result.verified_url ?? '')
      } catch {
        resolve('')
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      console.error('verify_urls.py spawn error:', err.message)
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
    console.error(teamsErr.message)
    return Response.json({ error: 'Failed to fetch teams' }, { status: 500 })
  }

  await supabaseAdmin.rpc('ce_update_batch_status', {
    p_batch_id: batch_id,
    p_status: 'verifying_urls',
  })

  const teamRows = (teams ?? []) as TeamRow[]
  let verifiedCount = 0
  for (const team of teamRows) {
    if (!team.website) continue
    const verifiedUrl = await callVerifyUrl(team.website)
    if (verifiedUrl) {
      const { error } = await supabaseAdmin.rpc('ce_update_team_verified_url', {
        p_team_id: team.id,
        p_verified_url: verifiedUrl,
      })
      if (error) console.error(`update verified_url for ${team.id}: ${error.message}`)
      else verifiedCount++
    }
  }

  await supabaseAdmin.rpc('ce_update_batch_status', {
    p_batch_id: batch_id,
    p_status: 'complete',
  })

  return Response.json({ data: { batch_id, verified_count: verifiedCount } })
}
