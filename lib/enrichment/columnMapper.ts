import type { TeamSizeInput, ZillowInput, ColumnMapping } from '../supabase/types'

function get(rawRow: Record<string, string>, sourceColumn: string | null): string {
  if (sourceColumn === null) return ''
  return rawRow[sourceColumn] ?? ''
}

export function mapRowToBranches(
  rawRow: Record<string, string>,
  mapping: ColumnMapping
): { teamSizeRow: TeamSizeInput; zillowRow: ZillowInput } {
  const teamSizeRow: TeamSizeInput = {
    list_name: get(rawRow, mapping.list_name.source_column),
    list_email: get(rawRow, mapping.list_email.source_column),
    list_phone: get(rawRow, mapping.list_phone.source_column),
    list_team_name: get(rawRow, mapping.list_team_name.source_column),
    list_brokerage: get(rawRow, mapping.list_brokerage.source_column),
    list_website: get(rawRow, mapping.list_website.source_column),
    list_location: get(rawRow, mapping.list_location.source_column),
    HS_Ticket: get(rawRow, mapping.HS_Ticket.source_column),
  }

  const zillowRow: ZillowInput = {
    list_name: get(rawRow, mapping.list_name.source_column),
    list_company: get(rawRow, mapping.list_team_name.source_column),
    list_location: get(rawRow, mapping.list_location.source_column),
    brokerage_name: get(rawRow, mapping.list_brokerage.source_column),
    list_mobile: get(rawRow, mapping.list_phone.source_column),
    list_email: get(rawRow, mapping.list_email.source_column),
    HS_ticket_link: get(rawRow, mapping.HS_Ticket.source_column),
  }

  return { teamSizeRow, zillowRow }
}
