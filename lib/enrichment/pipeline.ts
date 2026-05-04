import { getRowsByJob, updateRow } from '../supabase/rows'
import { updateJob } from '../supabase/jobs'
import { runBranch1 } from './branch1-teamsize'
import { runBranch2 } from './branch2-contact'

export async function runEnrichmentPipeline(jobId: string): Promise<void> {
  try {
    const allRows = await getRowsByJob(jobId)

    if (allRows.length === 0) {
      await updateJob(jobId, { status: 'complete' })
      return
    }

    await updateJob(jobId, {
      status: 'both_running',
      branch1_status: 'running',
      branch2_status: 'running',
    })

    const [branch1Results, branch2Results] = await Promise.all([
      runBranch1(allRows),
      runBranch2(allRows),
    ])

    // Write Branch 1 results
    let branch1FoundCount = 0
    for (const result of branch1Results) {
      if (result.found) branch1FoundCount++
      await updateRow(result.row.id, {
        team_size_data: result.data,
        branch1_status: result.found ? 'found' : 'not_found',
      })
    }

    // Write Branch 2 results
    let branch2FoundCount = 0
    for (const result of branch2Results) {
      if (result.found) branch2FoundCount++
      await updateRow(result.row.id, {
        contact_data: result.data,
        branch2_status: result.found ? 'found' : 'not_found',
      })
    }

    await updateJob(jobId, {
      branch1_status: 'complete',
      branch2_status: 'complete',
      branch1_completed_at: new Date().toISOString(),
      branch2_completed_at: new Date().toISOString(),
      branch1_found_count: branch1FoundCount,
      branch2_found_count: branch2FoundCount,
      status: 'merging',
    })

    // Merge results into a single merged_data per row
    const branch1Map = new Map(branch1Results.map(r => [r.row.id, r.data]))
    const branch2Map = new Map(branch2Results.map(r => [r.row.id, r.data]))

    for (const row of allRows) {
      const teamData = branch1Map.get(row.id) ?? null
      const contactData = branch2Map.get(row.id) ?? null
      const fi = row.formatted_input

      const merged: Record<string, unknown> = {
        // identity
        name: fi?.name ?? null,
        email: fi?.email ?? null,
        phone: fi?.phone ?? null,
        location: fi?.location ?? null,
        hs_ticket_url: row.hs_ticket_url,

        // team size (branch 1)
        team_size_count: teamData?.team_size_count ?? null,
        team_size_category: teamData?.team_size_category ?? null,
        team_name_enriched: teamData?.team_name ?? null,
        brokerage_enriched: teamData?.brokerage_name ?? null,
        team_page_url: teamData?.team_page_url ?? null,
        homepage_url: teamData?.homepage_url ?? null,
        confidence: teamData?.confidence ?? null,
        team_members: teamData?.team_members ?? null,

        // contact (branch 2)
        zillow_profile: contactData?.profile_link ?? null,
        zillow_rating: contactData?.rating_average ?? null,
        zillow_reviews: contactData?.rating_count ?? null,
        zillow_sales_12m: contactData?.sales_last_12_months ?? null,
        zillow_sales_total: contactData?.sales_total ?? null,
        zillow_is_top_agent: contactData?.is_top_agent ?? null,
        zillow_is_team: contactData?.is_team ?? null,
        contact_source: contactData?.source ?? null,

        // metadata
        enriched_at: new Date().toISOString(),
        branch1_found: !!teamData,
        branch2_found: !!contactData,
      }

      await updateRow(row.id, { merged_data: merged })
    }

    await updateJob(jobId, { status: 'complete' })
  } catch (e) {
    await updateJob(jobId, {
      status: 'failed',
      error_log: e instanceof Error ? e.message : 'Unknown pipeline error',
    })
  }
}
