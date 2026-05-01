import type { EnrichRow } from '../supabase/types'

export type Stage2Result = {
  row: EnrichRow
  found: boolean
  enrichedData: Record<string, unknown> | null
}

export async function runStage2Mock(rows: EnrichRow[]): Promise<Stage2Result[]> {
  const results: Stage2Result[] = []

  for (const row of rows) {
    await new Promise(r => setTimeout(r, 10))

    const found = Math.random() > 0.7
    const fi = row.formatted_input

    results.push({
      row,
      found,
      enrichedData: found ? {
        source: 'internal_db',
        stage: 2,
        full_name: fi?.name,
        email: fi?.email,
        phone: fi?.phone,
        team_name: fi?.team_name,
        fetched_at: new Date().toISOString(),
      } : null,
    })
  }

  return results
}

// DB connection details to be provided
export async function runStage2Real(_rows: EnrichRow[]): Promise<Stage2Result[]> {
  throw new Error('Stage 2 real implementation pending — DB connection details not yet provided')
}

// swap to runStage2Real when DB connection details are provided
export function runStage2(rows: EnrichRow[]): Promise<Stage2Result[]> {
  return runStage2Mock(rows)
}
