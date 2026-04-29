export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/client'
import { env } from '@/lib/env'

export async function GET() {
  let supabaseOk = false
  let supabaseError: string | undefined

  try {
    const { error } = await supabaseAdmin
      .from('enrich_jobs')
      .select('id', { count: 'exact', head: true })

    if (error) {
      supabaseError = error.message
    } else {
      supabaseOk = true
    }
  } catch (err) {
    supabaseError = err instanceof Error ? err.message : String(err)
  }

  let geminiOk = false
  let geminiError: string | undefined

  try {
    geminiOk = env.GEMINI_API_KEY.length > 0
    if (!geminiOk) geminiError = 'GEMINI_API_KEY is empty'
  } catch (err) {
    geminiError = err instanceof Error ? err.message : String(err)
  }

  const ok = supabaseOk && geminiOk
  return Response.json(
    { ok, supabase: supabaseOk, gemini: geminiOk, errors: { supabase: supabaseError, gemini: geminiError } },
    { status: ok ? 200 : 503 }
  )
}
