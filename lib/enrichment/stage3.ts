import type { EnrichRow } from '../supabase/types'

export type Stage3Result = {
  row: EnrichRow
  found: boolean
  enrichedData: Record<string, unknown> | null
}

export async function runStage3Mock(rows: EnrichRow[]): Promise<Stage3Result[]> {
  const results: Stage3Result[] = []

  for (const row of rows) {
    await new Promise(r => setTimeout(r, 10))

    const found = Math.random() > 0.6
    const fi = row.formatted_input

    results.push({
      row,
      found,
      enrichedData: found ? {
        source: 'scrape_endpoint',
        stage: 3,
        full_name: fi?.name,
        email: fi?.email,
        team_name: fi?.team_name,
        team_size: Math.floor(Math.random() * 50) + 1,
        fetched_at: new Date().toISOString(),
      } : null,
    })
  }

  return results
}

// scrape endpoint URL not yet provided
export async function runStage3Real(_rows: EnrichRow[]): Promise<Stage3Result[]> {
  throw new Error('Stage 3 real implementation pending — scrape endpoint URL not yet provided')
}

// swap to runStage3Real when scrape endpoint is ready
export function runStage3(rows: EnrichRow[]): Promise<Stage3Result[]> {
  return runStage3Mock(rows)
}
