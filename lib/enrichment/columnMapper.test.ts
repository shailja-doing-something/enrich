import { describe, it, expect } from 'vitest'
import { mapRowToBranches } from './columnMapper'
import type { ColumnMapping } from '../supabase/types'

const testMapping: ColumnMapping = {
  list_name:      { source_column: 'attendee_name',  confidence: 'high' },
  list_email:     { source_column: 'attendee_email', confidence: 'high' },
  list_phone:     { source_column: 'phone_number',   confidence: 'high' },
  list_team_name: { source_column: 'team',           confidence: 'high' },
  list_brokerage: { source_column: 'brokerage',      confidence: 'high' },
  list_website:   { source_column: 'website',        confidence: 'high' },
  list_location:  { source_column: 'city_state',     confidence: 'high' },
  HS_Ticket:      { source_column: 'hs_link',        confidence: 'high' },
}

const testRow = {
  attendee_name: 'Jane Doe',
  attendee_email: 'jane@example.com',
  phone_number: '555-1234',
  team: 'Dream Team',
  brokerage: 'Keller Williams',
  website: 'https://jane.realtor',
  city_state: 'Austin, TX',
  hs_link: 'https://app.hubspot.com/contacts/1/ticket/42',
  extra_field: 'ignored',
}

describe('mapRowToBranches', () => {
  it('maps all fields correctly into teamSizeRow', () => {
    const { teamSizeRow } = mapRowToBranches(testRow, testMapping)
    expect(teamSizeRow.list_name).toBe('Jane Doe')
    expect(teamSizeRow.list_email).toBe('jane@example.com')
    expect(teamSizeRow.list_phone).toBe('555-1234')
    expect(teamSizeRow.list_team_name).toBe('Dream Team')
    expect(teamSizeRow.list_brokerage).toBe('Keller Williams')
    expect(teamSizeRow.list_website).toBe('https://jane.realtor')
    expect(teamSizeRow.list_location).toBe('Austin, TX')
    expect(teamSizeRow.HS_Ticket).toBe('https://app.hubspot.com/contacts/1/ticket/42')
  })

  it('maps list_phone to list_mobile in zillowRow', () => {
    const { zillowRow } = mapRowToBranches(testRow, testMapping)
    expect(zillowRow.list_mobile).toBe('555-1234')
  })

  it('maps list_team_name to list_company in zillowRow', () => {
    const { zillowRow } = mapRowToBranches(testRow, testMapping)
    expect(zillowRow.list_company).toBe('Dream Team')
  })

  it('maps list_brokerage to brokerage_name in zillowRow', () => {
    const { zillowRow } = mapRowToBranches(testRow, testMapping)
    expect(zillowRow.brokerage_name).toBe('Keller Williams')
  })

  it('maps HS_Ticket to HS_ticket_link in zillowRow', () => {
    const { zillowRow } = mapRowToBranches(testRow, testMapping)
    expect(zillowRow.HS_ticket_link).toBe('https://app.hubspot.com/contacts/1/ticket/42')
  })

  it('includes list_website in teamSizeRow but not in zillowRow', () => {
    const { teamSizeRow, zillowRow } = mapRowToBranches(testRow, testMapping)
    expect(teamSizeRow.list_website).toBe('https://jane.realtor')
    expect('list_website' in zillowRow).toBe(false)
  })

  it('returns empty string when source_column is null — does not throw', () => {
    const mappingWithNull: ColumnMapping = {
      ...testMapping,
      list_phone: { source_column: null, confidence: 'none' },
    }
    const { teamSizeRow, zillowRow } = mapRowToBranches(testRow, mappingWithNull)
    expect(teamSizeRow.list_phone).toBe('')
    expect(zillowRow.list_mobile).toBe('')
  })

  it('returns empty string when mapped column is missing from rawRow — does not throw', () => {
    const { teamSizeRow } = mapRowToBranches({}, testMapping)
    expect(teamSizeRow.list_name).toBe('')
    expect(teamSizeRow.HS_Ticket).toBe('')
  })

  it('extra keys in rawRow do not appear in either output', () => {
    const { teamSizeRow, zillowRow } = mapRowToBranches(testRow, testMapping)
    expect('extra_field' in teamSizeRow).toBe(false)
    expect('extra_field' in zillowRow).toBe(false)
  })
})
