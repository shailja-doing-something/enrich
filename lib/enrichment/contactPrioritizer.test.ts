import { describe, it, expect } from 'vitest'
import { prioritizeRows, summarizeRows } from './contactPrioritizer'
import type { EnrichRow, GenericFormattedRow } from '../supabase/types'

// ── Factories ─────────────────────────────────────────────────────────────────

function makeRow(fi: Partial<GenericFormattedRow> = {}, id = 'row-1'): EnrichRow {
  return {
    id,
    job_id: 'job-1',
    row_index: 0,
    hs_ticket_url: 'https://app.hubspot.com/ticket/1',
    raw_data: {},
    formatted_input: {
      name: 'Test User',
      email: '',
      phone: '',
      team_name: '',
      brokerage: 'Keller Williams',   // provides RE signal by default
      website: '',
      location: '',
      hs_ticket_url: 'https://app.hubspot.com/ticket/1',
      ...fi,
    },
    enriched_data: null,
    enrichment_status: 'pending',
    stage_reached: null,
    team_size_data: null,
    contact_data: null,
    branch1_status: 'pending',
    branch2_status: 'pending',
    merged_data: null,
    priority_tier: null,
    rejected: null,
    rejection_reason: null,
    needs_review: null,
    work_email: null,
    inferred_website: null,
    inferred_company: null,
    team_name_normalized: null,
  }
}

// Row with no RE signal by default — for testing SaaS/ambiguous paths
function makeBlankRow(fi: Partial<GenericFormattedRow> = {}, id = 'row-1'): EnrichRow {
  return makeRow({ brokerage: '', team_name: '', ...fi }, id)
}

function makeGenericRow(overrides: Partial<GenericFormattedRow> = {}): GenericFormattedRow {
  return {
    name: 'Test User',
    email: '',
    phone: '',
    team_name: '',
    brokerage: 'Keller Williams',
    website: '',
    location: '',
    hs_ticket_url: 'https://app.hubspot.com/ticket/1',
    ...overrides,
  }
}

// Shortcut: run a single row through prioritizeRows and return the result
function classify(fi: Partial<GenericFormattedRow> = {}): EnrichRow {
  return prioritizeRows([makeRow(fi)])[0]
}

function classifyBlank(fi: Partial<GenericFormattedRow> = {}): EnrichRow {
  return prioritizeRows([makeBlankRow(fi)])[0]
}

// ── Step 0: Fello exclusion ───────────────────────────────────────────────────

describe('Fello exclusion', () => {
  it('excludes @fello.ai email', () => {
    const row = classify({ email: 'agent@fello.ai' })
    expect(row.priority_tier).toBe('Excluded')
  })

  it('excludes @getfello.com email', () => {
    const row = classify({ email: 'agent@getfello.com' })
    expect(row.priority_tier).toBe('Excluded')
  })

  it('excludes @fellopartner.com email', () => {
    const row = classify({ email: 'agent@fellopartner.com' })
    expect(row.priority_tier).toBe('Excluded')
  })

  it('excludes team_name containing "fello" (case-insensitive)', () => {
    const row = classify({ team_name: 'Fello Team' })
    expect(row.priority_tier).toBe('Excluded')
  })

  it('excludes team_name "Fello Real Estate" regardless of email', () => {
    const row = classify({ team_name: 'Fello Real Estate', email: 'agent@gmail.com' })
    expect(row.priority_tier).toBe('Excluded')
  })

  it('sets rejected = true and correct rejection_reason for Excluded rows', () => {
    const row = classify({ email: 'agent@fello.ai' })
    expect(row.rejected).toBe(true)
    expect(row.rejection_reason).toBe('Internal Fello record — excluded from processing')
    expect(row.needs_review).toBe(false)
  })

  it('does not exclude a normal agent whose name happens to contain "fellow"', () => {
    const row = classify({ team_name: 'Fellow Travelers Realty', email: 'agent@kwrealty.com' })
    expect(row.priority_tier).not.toBe('Excluded')
  })
})

// ── Step 1: Team name deduplication ──────────────────────────────────────────

describe('Team name deduplication', () => {
  it('normalizes "Sea Glass" and "Sea Glass Properties" to the longer canonical name', () => {
    const rows = prioritizeRows([
      makeRow({ team_name: 'Sea Glass',            email: 'a@seaglass.com',  brokerage: 'Keller Williams' }, 'r1'),
      makeRow({ team_name: 'Sea Glass Properties', email: 'b@seaglass.com',  brokerage: 'Keller Williams' }, 'r2'),
    ])
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(byId['r1'].team_name_normalized).toBe('Sea Glass Properties')
    expect(byId['r2'].team_name_normalized).toBe('Sea Glass Properties')
  })

  it('normalizes "Hovland Realty" and "Hovland Realty LLC" to the longer form', () => {
    const rows = prioritizeRows([
      makeRow({ team_name: 'Hovland Realty',     email: 'a@kwrealty.com', brokerage: '' }, 'r1'),
      makeRow({ team_name: 'Hovland Realty LLC', email: 'b@kwrealty.com', brokerage: '' }, 'r2'),
    ])
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(byId['r1'].team_name_normalized).toBe('Hovland Realty LLC')
    expect(byId['r2'].team_name_normalized).toBe('Hovland Realty LLC')
  })

  it('keeps two clearly different team names separate', () => {
    const rows = prioritizeRows([
      makeRow({ team_name: 'Smith Realty Group',  email: 'a@smithrealty.com',  brokerage: '' }, 'r1'),
      makeRow({ team_name: 'Johnson Home Team',   email: 'b@johnsonhomes.com', brokerage: '' }, 'r2'),
    ])
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(byId['r1'].team_name_normalized).toBe('Smith Realty Group')
    expect(byId['r2'].team_name_normalized).toBe('Johnson Home Team')
  })

  it('sets team_name_normalized to the input value when there is only one row', () => {
    const row = classify({ team_name: 'Apex Realty' })
    expect(row.team_name_normalized).toBe('Apex Realty')
  })

  it('sets team_name_normalized to empty string when team_name is empty', () => {
    const row = classify({ team_name: '' })
    expect(row.team_name_normalized).toBe('')
  })
})

// ── Step 2: Real estate validation ───────────────────────────────────────────

describe('Real estate validation', () => {
  it('passes RE validation when brokerage contains a known RE signal', () => {
    const row = classify({ email: 'agent@gmail.com', phone: '1234567890' })
    expect(row.priority_tier).not.toBe('Rejected')
    expect(row.rejected).toBe(false)
  })

  it('rejects rows whose email domain is a known SaaS company', () => {
    const row = classifyBlank({ email: 'agent@hubspot.com' })
    expect(row.priority_tier).toBe('Rejected')
    expect(row.rejected).toBe(true)
    expect(row.rejection_reason).toContain('Non-real-estate')
  })

  it('rejects rows whose brokerage contains a SaaS keyword', () => {
    const row = classifyBlank({ brokerage: 'Acme Software Inc', email: 'agent@acme.com' })
    expect(row.priority_tier).toBe('Rejected')
  })

  it('rejects rows with a SaaS TLD on the work email domain', () => {
    const row = classifyBlank({ email: 'agent@startup.io' })
    expect(row.priority_tier).toBe('Rejected')
  })

  it('assigns P3 with needs_review when context is ambiguous (no RE, no SaaS signal)', () => {
    const row = classifyBlank({ email: 'agent@localplumber.com', phone: '1234567890' })
    expect(row.priority_tier).toBe('P3')
    expect(row.needs_review).toBe(true)
    expect(row.rejected).toBe(false)
  })

  it('uses inferred company from work email domain to detect RE signal', () => {
    // "kwrealty" contains "realty" — no explicit brokerage needed
    const row = classifyBlank({ email: 'agent@kwrealty.com', phone: '1234567890' })
    expect(row.priority_tier).not.toBe('Rejected')
    expect(row.priority_tier).not.toBe('Excluded')
  })
})

// ── Priority tiers ────────────────────────────────────────────────────────────

describe('Priority tier — P1', () => {
  it('assigns P1 for work email + 10-digit phone + no company mismatch', () => {
    // @kellerwilliams.com domain closely matches brokerage "Keller Williams" — no mismatch
    const row = classify({ email: 'agent@kellerwilliams.com', phone: '1234567890' })
    expect(row.priority_tier).toBe('P1')
    expect(row.work_email).toBe(true)
    expect(row.rejected).toBe(false)
    expect(row.needs_review).toBe(false)
  })

  it('assigns P1 when email domain matches the team_name closely', () => {
    const row = classify({
      email:     'agent@smithrealty.com',
      phone:     '9876543210',
      team_name: 'Smith Realty Group',
      brokerage: '',
    })
    expect(row.priority_tier).toBe('P1')
  })
})

describe('Priority tier — P2', () => {
  it('assigns P2 for work email with no phone', () => {
    const row = classify({ email: 'agent@kwrealty.com', phone: '' })
    expect(row.priority_tier).toBe('P2')
    expect(row.work_email).toBe(true)
  })

  it('assigns P2 for work email with 7-digit (degraded) phone', () => {
    const row = classify({ email: 'agent@kwrealty.com', phone: '5551234' })
    expect(row.priority_tier).toBe('P2')
  })

  it('assigns P2 for work email + 10-digit phone + company mismatch, sets needs_review', () => {
    // "techwidgets" does not match "Keller Williams"
    const row = classify({ email: 'agent@techwidgets.com', phone: '1234567890' })
    expect(row.priority_tier).toBe('P2')
    expect(row.needs_review).toBe(true)
    expect(row.rejection_reason).toContain('mismatch')
  })

  it('assigns P2 for personal email + 10-digit phone', () => {
    const row = classify({ email: 'agent@gmail.com', phone: '1234567890' })
    expect(row.priority_tier).toBe('P2')
    expect(row.work_email).toBe(false)
  })

  it('assigns P2 for personal email + 7-digit phone', () => {
    const row = classify({ email: 'agent@yahoo.com', phone: '5551234' })
    expect(row.priority_tier).toBe('P2')
  })
})

describe('Priority tier — P3', () => {
  it('assigns P3 for personal email + no phone', () => {
    const row = classify({ email: 'agent@gmail.com', phone: '' })
    expect(row.priority_tier).toBe('P3')
    expect(row.needs_review).toBe(false)
  })

  it('assigns P3 when there is no email at all', () => {
    const row = classify({ email: '', phone: '1234567890' })
    expect(row.priority_tier).toBe('P3')
    expect(row.rejection_reason).toContain('No email')
  })

  it('assigns P3 for personal email + phone shorter than 7 digits', () => {
    const row = classify({ email: 'agent@outlook.com', phone: '12345' })
    expect(row.priority_tier).toBe('P3')
  })
})

// ── Email classification and inference ───────────────────────────────────────

describe('Email classification', () => {
  it('marks a non-personal-domain email as work_email = true', () => {
    const row = classify({ email: 'agent@kwrealty.com' })
    expect(row.work_email).toBe(true)
  })

  it('marks a gmail address as work_email = false', () => {
    const row = classify({ email: 'agent@gmail.com' })
    expect(row.work_email).toBe(false)
  })

  it('marks an empty email as work_email = false', () => {
    const row = classify({ email: '' })
    expect(row.work_email).toBe(false)
  })

  it('populates inferred_website and inferred_company from a work email domain', () => {
    const row = classify({ email: 'agent@kwrealty.com' })
    expect(row.inferred_website).toBe('kwrealty.com')
    expect(row.inferred_company).toBe('kwrealty')
  })

  it('leaves inferred_website and inferred_company empty for personal email', () => {
    const row = classify({ email: 'agent@gmail.com' })
    expect(row.inferred_website).toBe('')
    expect(row.inferred_company).toBe('')
  })

  it('leaves inferred fields empty when no email is present', () => {
    const row = classify({ email: '' })
    expect(row.inferred_website).toBe('')
    expect(row.inferred_company).toBe('')
  })
})

// ── Phone normalization ───────────────────────────────────────────────────────

describe('Phone normalization', () => {
  it('treats an 11-digit phone (with country code) as 10-digit valid after taking last 10', () => {
    // 11 digits → last 10 → phoneValid = 'Yes'
    const row = classify({ email: 'agent@kellerwilliams.com', phone: '12345678901' })
    expect(row.priority_tier).toBe('P1')
  })

  it('treats a phone with formatting characters the same as raw digits', () => {
    const row = classify({ email: 'agent@kellerwilliams.com', phone: '(234) 567-8901' })
    expect(row.priority_tier).toBe('P1')
  })

  it('treats a 6-digit phone as invalid (P3 with personal email)', () => {
    const row = classify({ email: 'agent@gmail.com', phone: '123456' })
    expect(row.priority_tier).toBe('P3')
  })
})

// ── Company mismatch ──────────────────────────────────────────────────────────

describe('Company mismatch detection', () => {
  it('does not flag a mismatch when inferred company closely matches brokerage', () => {
    // "kellerwilliams" vs "Keller Williams" — Levenshtein distance is 1 (the space)
    const row = classify({ email: 'agent@kellerwilliams.com', phone: '1234567890' })
    expect(row.priority_tier).toBe('P1')
    expect(row.needs_review).toBe(false)
  })

  it('flags a mismatch when inferred company is clearly different from team/brokerage', () => {
    const row = classify({ email: 'agent@techwidgets.com', phone: '1234567890' })
    expect(row.needs_review).toBe(true)
    expect(row.rejection_reason).toContain('mismatch')
  })

  it('does not check mismatch for personal email (no inferred company)', () => {
    const row = classify({ email: 'agent@gmail.com', phone: '1234567890' })
    expect(row.needs_review).toBe(false)
  })

  it('does not check mismatch when no email is present', () => {
    const row = classify({ email: '', phone: '1234567890' })
    expect(row.needs_review).toBe(false)
  })
})

// ── Output sorting ────────────────────────────────────────────────────────────

describe('Output sorting', () => {
  it('sorts enrichable rows P1 → P2 → P3 regardless of input order', () => {
    const rows = prioritizeRows([
      makeRow({ email: 'agent@gmail.com',          phone: '',           brokerage: 'Keller Williams' }, 'p3'),
      makeRow({ email: 'agent@kellerwilliams.com', phone: '1234567890', brokerage: 'Keller Williams' }, 'p1'),
      makeRow({ email: 'agent@kwrealty.com',        phone: '',           brokerage: 'Keller Williams' }, 'p2'),
    ])
    const tiers = rows.map(r => r.priority_tier)
    expect(tiers).toEqual(['P1', 'P2', 'P3'])
  })

  it('places Excluded and Rejected rows after all enrichable rows', () => {
    const rows = prioritizeRows([
      makeRow(  { email: 'agent@fello.ai',     phone: '' },           'excluded'),
      makeBlankRow({ email: 'agent@hubspot.com', phone: '' },          'rejected'),
      makeRow(  { email: 'agent@gmail.com',     phone: '1234567890' }, 'p2'),
    ])
    const tiers = rows.map(r => r.priority_tier)
    expect(tiers[0]).toBe('P2')
    expect(tiers.slice(1)).toEqual(expect.arrayContaining(['Excluded', 'Rejected']))
  })

  it('preserves all rows — output length equals input length', () => {
    const input = [
      makeRow({ email: 'a@kellerwilliams.com', phone: '1234567890' }, 'r1'),
      makeRow({ email: 'b@gmail.com',           phone: '' },          'r2'),
      makeRow({ email: 'c@fello.ai' },                                'r3'),
    ]
    expect(prioritizeRows(input)).toHaveLength(3)
  })
})

// ── summarizeRows ─────────────────────────────────────────────────────────────

describe('summarizeRows', () => {
  it('returns all-zero counts for an empty array', () => {
    const summary = summarizeRows([])
    expect(summary).toEqual({ p1: 0, p2: 0, p3: 0, excluded: 0, rejected: 0, total: 0 })
  })

  it('total equals rows.length', () => {
    const rows = [
      makeGenericRow({ email: 'a@kellerwilliams.com', phone: '1234567890' }),
      makeGenericRow({ email: 'b@gmail.com',           phone: '' }),
      makeGenericRow({ email: 'c@fello.ai' }),
    ]
    expect(summarizeRows(rows).total).toBe(3)
  })

  it('counts each tier correctly for a mixed set of rows', () => {
    const rows = [
      makeGenericRow({ email: 'a@kellerwilliams.com', phone: '1234567890' }),  // P1
      makeGenericRow({ email: 'b@kwrealty.com',        phone: '' }),            // P2
      makeGenericRow({ email: 'c@gmail.com',           phone: '' }),            // P3
      makeGenericRow({ email: 'd@fello.ai' }),                                  // Excluded
      makeGenericRow({ email: 'e@hubspot.com',  brokerage: '', team_name: '' }), // Rejected
    ]
    const s = summarizeRows(rows)
    expect(s.p1).toBe(1)
    expect(s.p2).toBe(1)
    expect(s.p3).toBe(1)
    expect(s.excluded).toBe(1)
    expect(s.rejected).toBe(1)
  })

  it('counts a single P1 row correctly', () => {
    const rows = [makeGenericRow({ email: 'agent@kellerwilliams.com', phone: '1234567890' })]
    const s = summarizeRows(rows)
    expect(s.p1).toBe(1)
    expect(s.p2 + s.p3 + s.excluded + s.rejected).toBe(0)
  })
})
