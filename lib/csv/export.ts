import Papa from 'papaparse'
import type { EnrichRow } from '@/lib/supabase/types'

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
    return record
  })

  return Papa.unparse(data)
}

export function buildStage2CSV(rows: EnrichRow[]): string {
  const extraKeys   = collectKeys(rows, 'extra_fields')
  const profileKeys = collectKeys(rows, 'zillow_profile')

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
    record['Zillow URL'] = row.zillow_url ?? ''
    record['Match Type'] = row.match_type ?? ''
    for (const key of profileKeys) {
      record[key] = stringify(row.zillow_profile[key])
    }
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
  return String(value)
}
