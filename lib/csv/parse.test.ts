import { describe, it, expect } from 'vitest'
import { parseCSV } from './parse'

describe('parseCSV', () => {
  it('maps known columns case-insensitively', () => {
    const csv = `Name,EMAIL,phone,Location,Website\nJane Doe,jane@example.com,5551234567,"Austin, TX",https://jane.com`
    const rows = parseCSV(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Jane Doe')
    expect(rows[0].email).toBe('jane@example.com')
    expect(rows[0].phone).toBe('5551234567')
    expect(rows[0].location).toBe('Austin, TX')
    expect(rows[0].website).toBe('https://jane.com')
  })

  it('puts unknown columns into extra_fields', () => {
    const csv = `Name,Email,CustomField\nJohn,john@example.com,some value`
    const [row] = parseCSV(csv)
    expect(row.extra_fields['CustomField']).toBe('some value')
  })

  it('filters rows where both name and email are empty', () => {
    const csv = `Name,Email\n,\nJane,jane@example.com`
    const rows = parseCSV(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Jane')
  })

  it('returns empty array on parse failure', () => {
    expect(parseCSV('')).toEqual([])
  })
})
