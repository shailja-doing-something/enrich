import type { GenericFormattedRow, ColumnMapping } from '../supabase/types'
import { cleanPhone, cleanEmail, cleanName } from './cleaners'

function get(rawRow: Record<string, string>, sourceColumn: string | null): string {
  if (sourceColumn === null) return ''
  return rawRow[sourceColumn] ?? ''
}

export function mapRowToGeneric(
  rawRow: Record<string, string>,
  mapping: ColumnMapping,
  hsTicketUrl: string
): GenericFormattedRow {
  const fullName = mapping.name?.source_column
    ? (rawRow[mapping.name.source_column] ?? '').trim()
    : ''
  const firstName = mapping.first_name?.source_column
    ? (rawRow[mapping.first_name.source_column] ?? '').trim()
    : ''
  const lastName = mapping.last_name?.source_column
    ? (rawRow[mapping.last_name.source_column] ?? '').trim()
    : ''
  const name = fullName || [firstName, lastName].filter(Boolean).join(' ') || ''

  const fullLocation = mapping.location?.source_column
    ? (rawRow[mapping.location.source_column] ?? '').trim()
    : ''
  const city = mapping.city?.source_column
    ? (rawRow[mapping.city.source_column] ?? '').trim()
    : ''
  const state = mapping.state?.source_column
    ? (rawRow[mapping.state.source_column] ?? '').trim()
    : ''
  const location = fullLocation || [city, state].filter(Boolean).join(', ') || ''

  return {
    name:          cleanName(name),
    email:         cleanEmail(get(rawRow, mapping.email.source_column)),
    phone:         cleanPhone(get(rawRow, mapping.phone.source_column)),
    team_name:     get(rawRow, mapping.team_name.source_column).trim(),
    brokerage:     get(rawRow, mapping.brokerage.source_column).trim(),
    website:       get(rawRow, mapping.website.source_column).trim(),
    location:      location.trim(),
    hs_ticket_url: hsTicketUrl,
  }
}
