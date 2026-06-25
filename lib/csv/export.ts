import Papa from 'papaparse'
import type { EnrichRow } from '@/lib/supabase/types'

const ZILLOW_COLS = [
  'full_name', 'screen_name', 'business_name', 'title', 'member_since',
  'phone_cell', 'phone_brokerage', 'phone_business',
  'address_street', 'address_city', 'address_state', 'address_zip', 'website_url',
  'is_top_agent', 'is_team', 'is_premier_agent', 'is_premium',
  'team_name', 'team_member_count', 'team_role',
  'rating_average', 'rating_count',
  'sales_last_12_months', 'sales_total',
  'price_range_min', 'price_range_max', 'average_price', 'years_of_experience',
  'active_listings_count', 'has_showcase', 'badge_name', 'past_sales_total',
  'facebook_url', 'instagram_url', 'tiktok_url', 'x_url', 'youtube_url', 'linkedin_url',
  'profile_photo_url', 'video_url', 'bio', 'pronouns', 'brand_color', 'scraped_at',
  'specialties', 'languages', 'service_areas', 'profile_types',
  'agent_licenses', 'other_licenses', 'mls_ids',
]

export function buildStage1CSV(rows: EnrichRow[]): string {
  const extraKeys = collectKeys(rows, 'extra_fields')

  const data = rows.map(row => {
    const record: Record<string, string> = {
      Name:     row.name     ?? '',
      Email:    row.email    ?? '',
      Phone:    row.phone    ?? '',
      Location: row.location ?? '',
      Website:  row.website  ?? '',
      Company:  row.company  ?? '',
    }
    for (const key of extraKeys) {
      record[key] = stringify(row.extra_fields[key])
    }
    record['Zillow URL']  = row.zillow_url  ?? ''
    record['Match Type']  = row.match_type  ?? ''

    const profile = row.zillow_profile as Record<string, unknown>
    for (const col of ZILLOW_COLS) {
      record[`zillow_${col}`] = stringify(profile?.[col])
    }
    return record
  })

  return Papa.unparse(data)
}

export function buildStage2CSV(rows: EnrichRow[]): string {
  const extraKeys = collectKeys(rows, 'extra_fields')

  const data = rows.map(row => {
    const record: Record<string, string> = {
      Name:     row.name     ?? '',
      Email:    row.email    ?? '',
      Phone:    row.phone    ?? '',
      Location: row.location ?? '',
      Website:  row.website  ?? '',
      Company:  row.company  ?? '',
    }
    for (const key of extraKeys) {
      record[key] = stringify(row.extra_fields[key])
    }
    record['Zillow URL']  = row.zillow_url  ?? ''
    record['Match Type']  = row.match_type  ?? ''

    const profile = row.zillow_profile as Record<string, unknown>
    for (const col of ZILLOW_COLS) {
      record[`zillow_${col}`] = stringify(profile?.[col])
    }

    // TODO: populated by Stage 2 team size enrichment
    record['zillow_team_size_data'] = ''
    return record
  })

  return Papa.unparse(data)
}

function collectKeys(rows: EnrichRow[], field: 'extra_fields' | 'zillow_profile'): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row[field])) keys.add(key)
  }
  return Array.from(keys)
}

function stringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
