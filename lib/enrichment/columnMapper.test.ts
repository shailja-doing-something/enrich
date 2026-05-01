import { describe, it, expect } from 'vitest'
import { mapRowToGeneric } from './columnMapper'
import type { ColumnMapping } from '../supabase/types'

const testMapping: ColumnMapping = {
  name:      { source_column: 'attendee_name',  confidence: 'high' },
  email:     { source_column: 'attendee_email', confidence: 'high' },
  phone:     { source_column: 'phone_number',   confidence: 'high' },
  team_name: { source_column: 'team',           confidence: 'high' },
  brokerage: { source_column: 'brokerage',      confidence: 'high' },
  website:   { source_column: 'website',        confidence: 'high' },
  location:  { source_column: 'city_state',     confidence: 'high' },
}

const testRow = {
  attendee_name:  'Jane Doe',
  attendee_email: 'jane@example.com',
  phone_number:   '555-1234',
  team:           'Dream Team',
  brokerage:      'Keller Williams',
  website:        'https://jane.realtor',
  city_state:     'Austin, TX',
  extra_field:    'ignored',
}

const HS_TICKET = 'https://app.hubspot.com/contacts/1/ticket/42'

describe('mapRowToGeneric', () => {
  it('maps all seven source columns into the correct target fields', () => {
    const row = mapRowToGeneric(testRow, testMapping, HS_TICKET)
    expect(row.name).toBe('Jane Doe')
    expect(row.email).toBe('jane@example.com')
    expect(row.phone).toBe('555-1234')
    expect(row.team_name).toBe('Dream Team')
    expect(row.brokerage).toBe('Keller Williams')
    expect(row.website).toBe('https://jane.realtor')
    expect(row.location).toBe('Austin, TX')
  })

  it('stamps hs_ticket_url from the parameter, not from the raw row', () => {
    const row = mapRowToGeneric(testRow, testMapping, HS_TICKET)
    expect(row.hs_ticket_url).toBe(HS_TICKET)
  })

  it('output always has exactly the eight GenericFormattedRow keys', () => {
    const row = mapRowToGeneric(testRow, testMapping, HS_TICKET)
    const keys = Object.keys(row).sort()
    expect(keys).toEqual(
      ['brokerage', 'email', 'hs_ticket_url', 'location', 'name', 'phone', 'team_name', 'website']
    )
  })

  it('extra keys in rawRow do not appear in output', () => {
    const row = mapRowToGeneric(testRow, testMapping, HS_TICKET)
    expect('extra_field' in row).toBe(false)
  })

  it('returns empty string when source_column is null — does not throw', () => {
    const mappingWithNull: ColumnMapping = {
      ...testMapping,
      phone: { source_column: null, confidence: 'none' },
    }
    const row = mapRowToGeneric(testRow, mappingWithNull, HS_TICKET)
    expect(row.phone).toBe('')
  })

  it('returns empty string when mapped column is missing from rawRow — does not throw', () => {
    const row = mapRowToGeneric({}, testMapping, HS_TICKET)
    expect(row.name).toBe('')
    expect(row.email).toBe('')
    expect(row.location).toBe('')
  })

  it('all missing fields produce empty strings, hs_ticket_url still stamped', () => {
    const row = mapRowToGeneric({}, testMapping, HS_TICKET)
    expect(row.hs_ticket_url).toBe(HS_TICKET)
    const fieldValues = [row.name, row.email, row.phone, row.team_name, row.brokerage, row.website, row.location]
    expect(fieldValues.every(v => v === '')).toBe(true)
  })

  it('multiple null source_columns all produce empty strings', () => {
    const allNullMapping: ColumnMapping = {
      name:      { source_column: null, confidence: 'none' },
      email:     { source_column: null, confidence: 'none' },
      phone:     { source_column: null, confidence: 'none' },
      team_name: { source_column: null, confidence: 'none' },
      brokerage: { source_column: null, confidence: 'none' },
      website:   { source_column: null, confidence: 'none' },
      location:  { source_column: null, confidence: 'none' },
    }
    const row = mapRowToGeneric(testRow, allNullMapping, HS_TICKET)
    expect(row.name).toBe('')
    expect(row.brokerage).toBe('')
    expect(row.location).toBe('')
  })

  it('different hs_ticket_url values are stamped correctly', () => {
    const url1 = 'https://app.hubspot.com/contacts/1/ticket/1'
    const url2 = 'https://app.hubspot.com/contacts/1/ticket/2'
    expect(mapRowToGeneric(testRow, testMapping, url1).hs_ticket_url).toBe(url1)
    expect(mapRowToGeneric(testRow, testMapping, url2).hs_ticket_url).toBe(url2)
  })
})
