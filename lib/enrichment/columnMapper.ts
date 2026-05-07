import type { GenericFormattedRow, ColumnMapping } from '../supabase/types'
import { cleanPhone, cleanEmail, cleanName } from './cleaners'

function resolveField(
  rawRow: Record<string, string>,
  sourceColumn: string | null,
  separator: string = ' '
): string {
  if (!sourceColumn) return ''
  if (sourceColumn.includes('|')) {
    const parts = sourceColumn.split('|')
    return parts
      .map(col => (rawRow[col.trim()] ?? '').trim())
      .filter(Boolean)
      .join(separator)
  }
  return (rawRow[sourceColumn] ?? '').trim()
}

export function mapRowToGeneric(
  rawRow: Record<string, string>,
  mapping: ColumnMapping,
  hsTicketUrl: string
): GenericFormattedRow {
  const name = resolveField(rawRow, mapping.name?.source_column ?? null, ' ')
  const location = resolveField(rawRow, mapping.location?.source_column ?? null, ', ')

  return {
    name:          cleanName(name),
    email:         cleanEmail(resolveField(rawRow, mapping.email?.source_column ?? null)),
    phone:         cleanPhone(resolveField(rawRow, mapping.phone?.source_column ?? null)),
    team_name:     resolveField(rawRow, mapping.team_name?.source_column ?? null).trim(),
    brokerage:     resolveField(rawRow, mapping.brokerage?.source_column ?? null).trim(),
    website:       resolveField(rawRow, mapping.website?.source_column ?? null).trim(),
    location:      cleanName(location),
    hs_ticket_url: hsTicketUrl,
  }
}
