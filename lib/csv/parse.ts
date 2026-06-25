import Papa from 'papaparse'

export type ParsedRow = {
  name: string
  email: string
  phone: string
  location: string
  website: string
  extra_fields: Record<string, string>
}

const KNOWN_COLUMNS: Record<string, keyof Omit<ParsedRow, 'extra_fields'>> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  location: 'location',
  website: 'website',
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

        return {
          name:     known.name     ?? '',
          email:    known.email    ?? '',
          phone:    known.phone    ?? '',
          location: known.location ?? '',
          website:  known.website  ?? '',
          extra_fields,
        }
      })
      .filter(row => row.name !== '' || row.email !== '')
  } catch {
    return []
  }
}
