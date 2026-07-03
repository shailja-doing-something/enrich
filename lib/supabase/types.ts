export type MadEnrichJob = {
  id: string
  filename: string
  total_rows: number
  status: 'pending' | 'running' | 'done' | 'error'
  matched: number
  completed_at: string | null
  created_at: string
  match_config: string[][]
}

export type MadEnrichRow = {
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
  match_type: string | null
  mad_profile: Record<string, unknown>
  completed_at: string | null
  created_at: string
}

export type EnrichJob = {
  id: string
  filename: string
  total_rows: number
  stage1_status: 'pending' | 'running' | 'done' | 'error'
  stage1_matched: number
  stage1_completed_at: string | null
  created_at: string
  match_config: string[][]
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
  match_type: string | null
  zillow_profile: Record<string, unknown>
  stage1_completed_at: string | null
  created_at: string
}
