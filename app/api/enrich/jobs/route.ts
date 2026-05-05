import { supabaseAdmin } from '@/lib/supabase/client'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(_request: NextRequest) {
  try {
    const { data: jobs, error } = await supabaseAdmin
      .from('enrich_jobs')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return new Response(JSON.stringify({ data: jobs ?? [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('Jobs list error:', e)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
