import type { GenericFormattedRow, ColumnMapping } from '../supabase/types'

function get(rawRow: Record<string, string>, sourceColumn: string | null): string {
  if (sourceColumn === null) return ''
  return rawRow[sourceColumn] ?? ''
}

export function mapRowToGeneric(
  rawRow: Record<string, string>,
  mapping: ColumnMapping,
  hsTicketUrl: string
): GenericFormattedRow {
  return {
    name:         get(rawRow, mapping.name.source_column),
    email:        get(rawRow, mapping.email.source_column),
    phone:        get(rawRow, mapping.phone.source_column),
    team_name:    get(rawRow, mapping.team_name.source_column),
    brokerage:    get(rawRow, mapping.brokerage.source_column),
    website:      get(rawRow, mapping.website.source_column),
    location:     get(rawRow, mapping.location.source_column),
    hs_ticket_url: hsTicketUrl,
  }
}
