import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '../env'

let _public: SupabaseClient | null = null
let _admin: SupabaseClient | null = null

export const supabasePublic = new Proxy({}, {
  get(_target, prop, receiver) {
    if (!_public) _public = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    return Reflect.get(_public, prop, receiver)
  },
}) as SupabaseClient

export const supabaseAdmin = new Proxy({}, {
  get(_target, prop, receiver) {
    if (!_admin) _admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    return Reflect.get(_admin, prop, receiver)
  },
}) as SupabaseClient
