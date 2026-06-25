import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

let _zillow: SupabaseClient | null = null

export const zillowDb = new Proxy({}, {
  get(_target, prop, receiver) {
    if (!_zillow) _zillow = createClient(env.ZILLOW_SUPABASE_URL, env.ZILLOW_SUPABASE_KEY)
    return Reflect.get(_zillow, prop, receiver)
  },
}) as SupabaseClient
