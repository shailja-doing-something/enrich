export type TeamSizeInput = {
  list_name: string
  list_email: string
  list_phone: string
  list_team_name: string
  list_brokerage: string
  list_website: string
  list_location: string
  HS_Ticket: string
}

export type ZillowInput = {
  list_name: string
  list_company: string
  list_location: string
  brokerage_name: string
  list_mobile: string
  list_email: string
  HS_ticket_link: string
}

export type ColumnMappingField = {
  source_column: string | null
  confidence: 'high' | 'medium' | 'low' | 'none'
}

export type ColumnMapping = {
  list_name: ColumnMappingField
  list_email: ColumnMappingField
  list_phone: ColumnMappingField
  list_team_name: ColumnMappingField
  list_brokerage: ColumnMappingField
  list_website: ColumnMappingField
  list_location: ColumnMappingField
  HS_Ticket: ColumnMappingField
}

export type EnrichJob = {
  id: string
  created_at: string
  updated_at: string
  sheet_url: string
  raw_row_count: number | null
  parsed_at: string | null
  column_mapping: ColumnMapping | null
  mapping_confirmed: boolean
  status: 'pending' | 'parsing' | 'mapping' | 'awaiting_confirmation' | 'generating' | 'ready' | 'running' | 'complete' | 'failed'
  team_size_status: 'idle' | 'running' | 'complete' | 'failed'
  zillow_status: 'idle' | 'running' | 'complete' | 'failed'
  team_size_completed_at: string | null
  zillow_completed_at: string | null
  merged_at: string | null
  hubspot_written_at: string | null
  error_log: string | null
  source_headers: string[] | null
  raw_csv: string | null
}

export type EnrichRow = {
  id: string
  job_id: string
  row_index: number
  hs_ticket_url: string
  raw_data: Record<string, string>
  team_size_input: TeamSizeInput | null
  zillow_input: ZillowInput | null
  team_size_data: Record<string, unknown> | null
  zillow_data: Record<string, unknown> | null
  phone_match: boolean | null
  email_match: boolean | null
  email_domain_match: boolean | null
  company_match: boolean | null
  zillow_verdict: 'yes' | 'no' | null
  zillow_score: number | null
  merged_data: Record<string, unknown> | null
}

export type InsertEnrichRow = {
  job_id: string
  row_index: number
  hs_ticket_url: string
  raw_data: Record<string, string>
  team_size_input: TeamSizeInput
  zillow_input: ZillowInput
}
