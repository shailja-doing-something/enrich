import { NextRequest } from 'next/server'
import { z } from 'zod'

const paramsSchema = z.object({ jobId: z.string().uuid() })

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://enrich-production-1129.up.railway.app'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid job ID' }, { status: 400 })
  }
  const { jobId } = parsed.data

  fetch(`${APP_URL}/api/enrich/pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  }).catch(err => console.error('[Fire] Pipeline trigger failed:', err))

  return Response.json({ ok: true })
}
