import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET() {
  const { data, error } = await supabaseAdmin.rpc('ce_get_batches_v2')
  if (error) {
    console.error(error.message)
    return Response.json({ error: 'Failed to fetch batches' }, { status: 500 })
  }
  return Response.json({ data }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
