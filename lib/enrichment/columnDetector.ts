import { GoogleGenerativeAI } from '@google/generative-ai'
import { env } from '../env'
import type { ColumnMapping, ColumnMappingField } from '../supabase/types'

const TARGET_FIELDS: Record<keyof ColumnMapping, string> = {
  name: "the person full name. If there is a single full name column, map source_column to it. If there are only separate first name and last name columns (no combined name column), set source_column to a JSON string like \"first_name|last_name\" using pipe as separator between the two column names.",
  email: 'email address',
  phone: 'phone or mobile number',
  team_name: 'real estate team or group name',
  brokerage: 'brokerage or franchise office name',
  website: 'personal or team website URL',
  location: "city, state or full location. If there is a single location/city-state column, map source_column to it. If there are only separate city and state columns, set source_column to \"city_col|state_col\" using pipe as separator.",
}

const EMPTY_FIELD: ColumnMappingField = { source_column: null, confidence: 'none' }

export async function detectColumnMapping(sourceHeaders: string[]): Promise<ColumnMapping> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

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
- For name: if a full name column exists use it directly. If only separate first/last name columns exist, set source_column to "FirstNameCol|LastNameCol" (pipe-separated).
- For location: if a combined column exists use it directly. If only separate city/state columns exist, set source_column to "CityCol|StateCol" (pipe-separated).
- Return JSON only — no markdown, no code fences, no explanation

Return format (exactly matching this structure):
{
  "name": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "email": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "phone": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "team_name": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "brokerage": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "website": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" },
  "location": { "source_column": "Column Name or null", "confidence": "high|medium|low|none" }
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
