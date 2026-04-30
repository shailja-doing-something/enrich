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
          'stage3_running' | 'complete' | 'failed'
  stage1_completed_at: string | null
  stage2_completed_at: string | null
  stage3_completed_at: string | null
  stage1_found_count: number | null
  stage2_found_count: number | null
  stage3_found_count: number | null
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
}

export type InsertEnrichRow = {
  job_id: string
  row_index: number
  hs_ticket_url: string
  raw_data: Record<string, string>
  formatted_input: GenericFormattedRow
}
