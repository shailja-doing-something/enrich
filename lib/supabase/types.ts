export type GenericFormattedRow = {
  name: string
  email: string
  phone: string
  team_name: string
  brokerage: string
  website: string
  location: string
  hs_ticket_url: string
}

export type ColumnMappingField = {
  source_column: string | null
  confidence: 'high' | 'medium' | 'low' | 'none'
}

export type ColumnMapping = {
  name: ColumnMappingField
  email: ColumnMappingField
  phone: ColumnMappingField
  team_name: ColumnMappingField
  brokerage: ColumnMappingField
  website: ColumnMappingField
  location: ColumnMappingField
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
  source_headers: string[] | null
  raw_csv: string | null
  hs_ticket_url: string | null
  status: 'pending' | 'parsing' | 'mapping' | 'awaiting_confirmation' |
          'generating' | 'ready' | 'stage1_running' | 'stage2_running' |
          'both_running' | 'branch1_running' | 'branch2_running' |
          'merging' | 'complete' | 'failed'
  branch1_status: 'idle' | 'running' | 'complete' | 'failed'
  branch2_status: 'idle' | 'running' | 'complete' | 'failed'
  branch1_completed_at: string | null
  branch2_completed_at: string | null
  branch1_found_count: number | null
  branch2_found_count: number | null
  hubspot_written_at: string | null
  error_log: string | null
}

export type EnrichRow = {
  id: string
  job_id: string
  row_index: number
  hs_ticket_url: string
  raw_data: Record<string, string>
  formatted_input: GenericFormattedRow | null
  enriched_data: Record<string, unknown> | null
  enrichment_status: 'pending' | 'found' | 'not_found'
  stage_reached: number | null
  team_size_data: Record<string, unknown> | null
  contact_data: Record<string, unknown> | null
  branch1_status: 'pending' | 'running' | 'found' | 'not_found' | 'failed'
  branch2_status: 'pending' | 'running' | 'found' | 'not_found' | 'failed'
  merged_data: Record<string, unknown> | null
}

export type InsertEnrichRow = {
  job_id: string
  row_index: number
  hs_ticket_url: string
  raw_data: Record<string, string>
  formatted_input: GenericFormattedRow
}
