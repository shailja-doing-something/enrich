import { GoogleGenerativeAI } from '@google/generative-ai'
import { env } from '../env'
import type { ColumnMapping, ColumnMappingField } from '../supabase/types'

const TARGET_FIELDS: Record<keyof ColumnMapping, string> = {
  list_name: "person's full name",
  list_email: 'email address',
  list_phone: 'phone or mobile number',
  list_team_name: 'real estate team or group name',
  list_brokerage: 'brokerage or franchise office name',
  list_website: 'personal or team website URL',
  list_location: 'city, state, or location',
  HS_Ticket: 'HubSpot ticket URL — usually contains app.hubspot.com',
}

const EMPTY_FIELD: ColumnMappingField = { source_column: null, confidence: 'none' }

export async function detectColumnMapping(sourceHeaders: string[]): Promise<ColumnMapping> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const fieldList = (Object.entries(TARGET_FIELDS) as [keyof ColumnMapping, string][])
    .map(([key, desc]) => `  - ${key}: ${desc}`)
    .join('\n')

  const prompt = `You are mapping spreadsheet column names to a fixed set of target fields for a real estate contacts sheet.

Source columns: ${JSON.stringify(sourceHeaders)}

Target fields:
${fieldList}

Rules:
- Map each target field to the single most likely source column
- If no source column matches, set source_column to null and confidence to "none"
- confidence: "high" = obvious match, "medium" = plausible, "low" = weak guess
- Return JSON only — no markdown, no code fences, no explanation

Return format (exactly matching this structure):
{
  "list_name": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "list_email": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "list_phone": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "list_team_name": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "list_brokerage": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "list_website": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "list_location": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "HS_Ticket": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" }
}`

  let raw: string
  try {
    const result = await model.generateContent(prompt)
    raw = result.response.text()
  } catch (err) {
    throw new Error(`Column detection failed: Gemini request error — ${String(err)}`)
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Column detection failed: invalid JSON from Gemini — ${cleaned.slice(0, 200)}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Column detection failed: Gemini returned non-object JSON')
  }

  const raw_obj = parsed as Record<string, unknown>
  const keys = Object.keys(TARGET_FIELDS) as (keyof ColumnMapping)[]

  const mapping = {} as ColumnMapping
  for (const key of keys) {
    const val = raw_obj[key]
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      'source_column' in val &&
      'confidence' in val
    ) {
      const v = val as Record<string, unknown>
      const source_column = v.source_column === null ? null : String(v.source_column)
      const confidence = (['high', 'medium', 'low', 'none'] as const).includes(v.confidence as 'high')
        ? (v.confidence as ColumnMappingField['confidence'])
        : 'none'
      mapping[key] = { source_column, confidence }
    } else {
      mapping[key] = EMPTY_FIELD
    }
  }

  return mapping
}
