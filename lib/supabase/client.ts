import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '../env'

let _admin: SupabaseClient | null = null

export const supabaseAdmin = new Proxy({}, {
  get(_target, prop, receiver) {
    if (!_admin) _admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
    return Reflect.get(_admin, prop, receiver)
  },
}) as SupabaseClient
