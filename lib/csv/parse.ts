import Papa from 'papaparse'

export type ParsedRow = {
  name: string
  email: string
  phone: string
  location: string
  website: string
  company: string
  extra_fields: Record<string, string>
}

const KNOWN_COLUMNS: Record<string, keyof Omit<ParsedRow, 'extra_fields'>> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  location: 'location',
  website: 'website',
  company: 'company',
  team: 'company',
  'team name': 'company',
  brokerage: 'company',
  organization: 'company',
}

function extractFirstValidPhone(raw: string): string {
  if (!raw) return ''

  const parts = raw.split(/[,;|\n\/]+/).map(p => p.trim()).filter(Boolean)

  for (const part of parts) {
    const digits = part.replace(/\D/g, '')
    const normalized = digits.slice(-10)
    if (normalized.length === 10) {
      return normalized
    }
  }

  const fallback = raw.replace(/\D/g, '').slice(-10)
  return fallback.length === 10 ? fallback : ''
}

export function parseCSV(text: string): ParsedRow[] {
  try {
    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    })

    return result.data
      .map(raw => {
        const known: Partial<Record<keyof Omit<ParsedRow, 'extra_fields'>, string>> = {}
        const extra_fields: Record<string, string> = {}

        for (const [col, value] of Object.entries(raw)) {
          const key = KNOWN_COLUMNS[col.toLowerCase().trim()]
          if (key) {
            known[key] = (value ?? '').trim()
          } else {
            extra_fields[col] = value ?? ''
          }
        }

        const rawPhone = known.phone ?? ''
        const phone = extractFirstValidPhone(rawPhone)

        // Preserve original when it contained multiple numbers or didn't parse cleanly
        if (rawPhone && (rawPhone !== phone)) {
          extra_fields['phone_raw'] = rawPhone
        }

        return {
          name:     known.name     ?? '',
          email:    known.email    ?? '',
          phone,
          location: known.location ?? '',
          website:  known.website  ?? '',
          company:  known.company  ?? '',
          extra_fields,
        }
      })
      .filter(row => row.name !== '' || row.email !== '')
  } catch {
    return []
  }
}
