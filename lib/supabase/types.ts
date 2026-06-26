export type EnrichJob = {
  id: string
  filename: string
  total_rows: number
  stage1_status: 'pending' | 'running' | 'done' | 'error'
  stage1_matched: number
  stage1_completed_at: string | null
  stage2_status: 'pending' | 'running' | 'done' | 'error'
  stage2_enriched: number
  stage2_completed_at: string | null
  created_at: string
}

export type EnrichRow = {
  id: string
  job_id: string
  row_index: number
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  website: string | null
  company: string | null
  extra_fields: Record<string, unknown>
  zillow_url: string | null
  match_type: 'email_company' | 'email' | 'name_team' | 'website' | 'phone_name' | 'name_company_state' | 'name_fuzzy' | 'no_match' | null
  zillow_profile: Record<string, unknown>
  stage1_completed_at:         string | null
  stage2_completed_at:         string | null
  stage2_team_size:            number | null
  stage2_team_size_confidence: string | null
  created_at: string
}
