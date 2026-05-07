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
      // ── Identity ──────────────────────────────────
      name: row.formatted_input?.name ?? null,
      email: row.formatted_input?.email ?? null,
      phone: row.formatted_input?.phone ?? null,
      location: row.formatted_input?.location ?? null,
      website: row.formatted_input?.website ?? null,
      team_name_input: row.formatted_input?.team_name ?? null,
      brokerage_input: row.formatted_input?.brokerage ?? null,
      hs_ticket_url: row.hs_ticket_url,

      // ── Team Size (Branch 1) ───────────────────────
      team_size_count: teamData?.team_size_count ?? null,
      team_size_category: teamData?.team_size_category ?? null,
      team_name_enriched: teamData?.team_name ?? null,
      brokerage_enriched: teamData?.brokerage_name ?? null,
      team_page_url: teamData?.team_page_url ?? null,
      homepage_url: teamData?.homepage_url ?? null,
      team_size_confidence: teamData?.confidence ?? null,
      team_size_reasoning: teamData?.reasoning ?? null,
      team_members_count: Array.isArray(teamData?.team_members)
        ? (teamData.team_members as unknown[]).length
        : null,
      team_members: teamData?.team_members ?? null,
      agent_designation: teamData?.agent_designation ?? null,
      detected_crms: teamData?.detected_crms ?? null,

      // ── Contact Enrichment (Branch 2) ─────────────
      contact_source: contactData?.source ?? null,
      contact_matched_on: contactData?.matched_on ?? null,

      // Zillow ZIP fields
      zillow_profile_link: contactData?.profile_link ?? null,
      zillow_screen_name: contactData?.screen_name ?? null,
      zillow_full_name: contactData?.full_name ?? null,
      zillow_title: contactData?.title ?? null,
      zillow_business_name: contactData?.business_name ?? null,
      zillow_phone_cell: contactData?.phone_cell ?? null,
      zillow_phone_brokerage: contactData?.phone_brokerage ?? null,
      zillow_phone_business: contactData?.phone_business ?? null,
      zillow_email: contactData?.email ?? null,
      zillow_address_city: contactData?.address_city ?? null,
      zillow_address_state: contactData?.address_state ?? null,
      zillow_address_zip: contactData?.address_zip ?? null,
      zillow_is_top_agent: contactData?.is_top_agent ?? null,
      zillow_is_team: contactData?.is_team ?? null,
      zillow_is_premier_agent: contactData?.is_premier_agent ?? null,
      zillow_team_name: contactData?.team_name ?? null,
      zillow_team_role: contactData?.team_role ?? null,
      zillow_team_member_count: contactData?.team_member_count ?? null,
      zillow_rating_average: contactData?.rating_average ?? null,
      zillow_rating_count: contactData?.rating_count ?? null,
      zillow_sales_last_12_months: contactData?.sales_last_12_months ?? null,
      zillow_sales_total: contactData?.sales_total ?? null,
      zillow_price_range_min: contactData?.price_range_min ?? null,
      zillow_price_range_max: contactData?.price_range_max ?? null,
      zillow_average_price: contactData?.average_price ?? null,
      zillow_years_of_experience: contactData?.years_of_experience ?? null,
      zillow_specialties: contactData?.specialties ?? null,
      zillow_languages: contactData?.languages ?? null,
      zillow_website_url: contactData?.website_url ?? null,
      zillow_facebook_url: contactData?.facebook_url ?? null,
      zillow_instagram_url: contactData?.instagram_url ?? null,
      zillow_linkedin_url: contactData?.linkedin_url ?? null,
      zillow_tiktok_url: contactData?.tiktok_url ?? null,
      zillow_youtube_url: contactData?.youtube_url ?? null,
      zillow_member_since: contactData?.member_since ?? null,
      zillow_badge_name: contactData?.badge_name ?? null,
      zillow_profile_photo_url: contactData?.profile_photo_url ?? null,
      zillow_service_areas: contactData?.service_areas ?? null,

      // mad.agents fields
      mad_id: contactData?.id ?? null,
      mad_first_name: contactData?.first_name ?? null,
      mad_last_name: contactData?.last_name ?? null,
      mad_job_title: contactData?.job_title ?? null,
      mad_company_domain: contactData?.company_domain ?? null,
      mad_team_id: contactData?.mad_team_id ?? null,
      mad_team_category_id: contactData?.team_category_id ?? null,
      mad_brokerage_id: contactData?.brokerage_id ?? null,
      mad_transactions_last_12m: contactData?.transactions_last_12m ?? null,

      // ── Metadata ──────────────────────────────────
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
