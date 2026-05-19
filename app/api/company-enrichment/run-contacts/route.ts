import { NextRequest } from 'next/server'
import { z } from 'zod'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
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

function subprocessEnv() {
  return {
    ...process.env,
    OXYLABS_USERNAME: env.OXYLABS_USERNAME,
    OXYLABS_PASSWORD: env.OXYLABS_PASSWORD,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    VITE_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    VITE_SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    VITE_FUNCTION_SECRET: env.FUNCTION_SECRET,
  }
}

function runScript(
  scriptPath: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [scriptPath, ...args], {
      cwd: opts.cwd,
      env: subprocessEnv(),
    })

    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`Script timed out after ${opts.timeoutMs / 1000}s: ${scriptPath}`))
    }, opts.timeoutMs)

    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`Script exited ${code}: ${stderr.trim().slice(0, 300)}`))
      } else {
        resolve()
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function runWebScraper(
  team: QualifiedTeam,
  teamDir: string
): Promise<string | null> {
  const inputCsvPath = path.join(teamDir, 'teams_input.csv')
  const priorityUrlsPath = path.join(teamDir, 'team_priority_urls.json')
  const agentsCsvPath = path.join(teamDir, 'agents.csv')

  // Write input CSV: uuid, team_name, url
  const csvContent = `uuid,team_name,url\n${team.team_id},"${(team.team_name ?? '').replace(/"/g, '""')}","${(team.website_url ?? '').replace(/"/g, '""')}"\n`
  await fs.writeFile(inputCsvPath, csvContent, 'utf8')

  const discoverScript = path.join(process.cwd(), 'scripts', 'enrichment', 'web-scraper', 'discover_team_urls.py')
  try {
    await runScript(discoverScript, [inputCsvPath], { cwd: teamDir, timeoutMs: 120_000 })
  } catch (err) {
    console.error(`[run-contacts] web discover failed for ${team.team_name}: ${(err as Error).message}`)
    return null
  }

  const priorityUrlsExists = await fs.access(priorityUrlsPath).then(() => true).catch(() => false)
  if (!priorityUrlsExists) return null

  const orchestrateScript = path.join(process.cwd(), 'scripts', 'enrichment', 'web-scraper', 'orchestrate.py')
  try {
    await runScript(orchestrateScript, [priorityUrlsPath], { cwd: teamDir, timeoutMs: 300_000 })
  } catch (err) {
    console.error(`[run-contacts] web orchestrate failed for ${team.team_name}: ${(err as Error).message}`)
    return null
  }

  const agentsExists = await fs.access(agentsCsvPath).then(() => true).catch(() => false)
  return agentsExists ? agentsCsvPath : null
}

async function runZillowScraper(
  team: QualifiedTeam,
  teamDir: string
): Promise<string | null> {
  const inputCsvPath = path.join(teamDir, 'zillow_input.csv')
  const agentsCsvPath = path.join(teamDir, 'agents_zillow.csv')

  // Write input CSV: team_id, team_name, zillow_url
  const csvContent = `team_id,team_name,zillow_url\n${team.team_id},"${(team.team_name ?? '').replace(/"/g, '""')}","${(team.zillow_url ?? '').replace(/"/g, '""')}"\n`
  await fs.writeFile(inputCsvPath, csvContent, 'utf8')

  const script = path.join(process.cwd(), 'scripts', 'enrichment', 'zillow-scraper', 'zillow_team_scraper.py')
  try {
    await runScript(script, [inputCsvPath], { cwd: teamDir, timeoutMs: 120_000 })
  } catch (err) {
    console.error(`[run-contacts] zillow scraper failed for ${team.team_name}: ${(err as Error).message}`)
    return null
  }

  const exists = await fs.access(agentsCsvPath).then(() => true).catch(() => false)
  return exists ? agentsCsvPath : null
}

async function runMerge(
  teamDir: string,
  webCsvPath: string | null,
  zillowCsvPath: string | null
): Promise<string | null> {
  const mergeScript = path.join(process.cwd(), 'scripts', 'enrichment', 'data-transform', 'merge_agents.py')
  const args: string[] = []
  if (webCsvPath) args.push('--web', webCsvPath)
  if (zillowCsvPath) args.push('--zillow', zillowCsvPath)
  if (args.length === 0) return null

  try {
    await runScript(mergeScript, args, { cwd: teamDir, timeoutMs: 120_000 })
  } catch (err) {
    console.error(`[run-contacts] merge failed: ${(err as Error).message}`)
    return null
  }

  const mergedPath = path.join(teamDir, 'agents_merged.csv')
  const exists = await fs.access(mergedPath).then(() => true).catch(() => false)
  return exists ? mergedPath : null
}

async function runClean(
  teamDir: string,
  mergedCsvPath: string
): Promise<string | null> {
  const cleanScript = path.join(process.cwd(), 'scripts', 'enrichment', 'data-cleaning', 'clean_contacts.py')
  try {
    await runScript(cleanScript, [mergedCsvPath], { cwd: teamDir, timeoutMs: 120_000 })
  } catch (err) {
    console.error(`[run-contacts] clean failed: ${(err as Error).message}`)
    return null
  }

  const xlsxPath = path.join(teamDir, 'agents_merged_contact_cleaned.xlsx')
  const exists = await fs.access(xlsxPath).then(() => true).catch(() => false)
  return exists ? xlsxPath : null
}

function parseXlsx(xlsxPath: string, teamId: string, batchId: string): AgentInsertRow[] {
  const wb = XLSX.readFile(xlsxPath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

  return rows
    .filter(r => typeof r['Email'] === 'string' && (r['Email'] as string).trim() !== '')
    .map(r => ({
      batch_id: batchId,
      team_id: teamId,
      first_name: String(r['First Name'] ?? ''),
      last_name: String(r['Last Name'] ?? ''),
      email: String(r['Email'] ?? '').trim().toLowerCase(),
      phone: String(r['Phone Number'] ?? ''),
      designation: String(r['Job Title'] ?? ''),
      source: String(r['source'] ?? ''),
    }))
}

async function enrichTeam(
  team: QualifiedTeam,
  batchId: string,
  teamDir: string
): Promise<AgentInsertRow[]> {
  await fs.mkdir(teamDir, { recursive: true })

  // SOURCE A and SOURCE B run in parallel
  const [webCsvPath, zillowCsvPath] = await Promise.all([
    team.web_valid ? runWebScraper(team, teamDir) : Promise.resolve(null),
    (team.zillow_valid && team.zillow_url) ? runZillowScraper(team, teamDir) : Promise.resolve(null),
  ])

  if (!webCsvPath && !zillowCsvPath) return []

  const mergedPath = await runMerge(teamDir, webCsvPath, zillowCsvPath)
  if (!mergedPath) return []

  // Skip clean (and openpyxl dependency) when there are no rows to process
  const mergedContent = await fs.readFile(mergedPath, 'utf8')
  const mergedRowCount = mergedContent.trim().split('\n').length - 1
  if (mergedRowCount <= 0) return []

  const xlsxPath = await runClean(teamDir, mergedPath)
  if (!xlsxPath) return []

  return parseXlsx(xlsxPath, team.team_id, batchId)
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

  // Mark unqualified teams skipped
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

  const batchTmpDir = path.join('/tmp', `enrich-${batch_id}`)
  let hasError = false
  let totalAgentsWritten = 0
  const debugErrors: string[] = []

  for (const team of qualifiedTeams) {
    const teamDir = path.join(batchTmpDir, team.team_id)
    console.log(`[run-contacts] processing team ${team.team_name} (${team.team_id}) zillow_valid=${team.zillow_valid} web_valid=${team.web_valid}`)
    try {
      const agents = await enrichTeam(team, batch_id, teamDir)
      console.log(`[run-contacts] enrichTeam returned ${agents.length} agents for ${team.team_name}`)

      if (agents.length > 0) {
        const { error: insertErr } = await supabaseAdmin.rpc('ce_insert_agents_bulk', {
          p_agents: agents,
        })
        if (insertErr) {
          throw new Error(`Agent insert failed: ${insertErr.message}`)
        }
        totalAgentsWritten += agents.length
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

  // Cleanup temp files on success only
  if (!hasError) {
    await fs.rm(batchTmpDir, { recursive: true, force: true }).catch(e => {
      console.error('[run-contacts] cleanup failed:', (e as Error).message)
    })
  }

  return Response.json({ data: { batch_id, processed: qualifiedTeams.length, agents_written: totalAgentsWritten, has_error: hasError, errors: debugErrors } })
}
