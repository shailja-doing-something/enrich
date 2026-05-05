import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getRowsByJob, updateRow } from '@/lib/supabase/rows'
import { updateJob } from '@/lib/supabase/jobs'

const bodySchema = z.object({
  jobId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 })
  }

  const { jobId } = parsed.data

  const rows = await getRowsByJob(jobId)

  for (const row of rows) {
    const teamData = row.team_size_data as Record<string, unknown> | null
    const contactData = row.contact_data as Record<string, unknown> | null

    const merged = {
      name: row.formatted_input?.name ?? null,
      email: row.formatted_input?.email ?? null,
      phone: row.formatted_input?.phone ?? null,
      location: row.formatted_input?.location ?? null,
      website: row.formatted_input?.website ?? null,
      hs_ticket_url: row.hs_ticket_url,
      team_size_count: teamData?.team_size_count ?? null,
      team_size_category: teamData?.team_size_category ?? null,
      team_name_enriched: teamData?.team_name ?? null,
      brokerage_enriched: teamData?.brokerage_name ?? null,
      team_page_url: teamData?.team_page_url ?? null,
      homepage_url: teamData?.homepage_url ?? null,
      team_size_confidence: teamData?.confidence ?? null,
      team_members_count: Array.isArray(teamData?.team_members)
        ? (teamData.team_members as unknown[]).length
        : null,
      zillow_profile: contactData?.profile_link ?? null,
      zillow_rating: contactData?.rating_average ?? null,
      zillow_reviews: contactData?.rating_count ?? null,
      zillow_sales_12m: contactData?.sales_last_12_months ?? null,
      zillow_sales_total: contactData?.sales_total ?? null,
      zillow_is_top_agent: contactData?.is_top_agent ?? null,
      zillow_is_team: contactData?.is_team ?? null,
      zillow_phone: contactData?.phone_cell ?? null,
      zillow_business: contactData?.business_name ?? null,
      contact_source: contactData?.source ?? null,
      enriched_at: new Date().toISOString(),
      branch1_found: !!teamData,
      branch2_found: !!contactData,
    }

    try {
      await updateRow(row.id, { merged_data: merged })
    } catch (e) {
      console.error(`Merge failed for row ${row.id}:`, e instanceof Error ? e.message : e)
    }
  }

  await updateJob(jobId, { status: 'complete' })

  return Response.json({ merged: rows.length })
}
