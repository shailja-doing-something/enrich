export const dynamic = 'force-dynamic'

import { listJobs } from '@/lib/supabase/jobs'

export async function GET() {
  const jobs = await listJobs()
  return Response.json({ data: jobs }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  })
}
