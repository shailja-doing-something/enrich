function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const env = {
  get SUPABASE_URL()           { return required('NEXT_PUBLIC_SUPABASE_URL') },
  get SUPABASE_SERVICE_KEY()   { return required('SUPABASE_SERVICE_ROLE_KEY') },
  get ZILLOW_SUPABASE_URL()    { return required('ZILLOW_SUPABASE_URL') },
  get ZILLOW_SUPABASE_KEY()    { return required('ZILLOW_SUPABASE_KEY') },
  get NEXT_PUBLIC_APP_URL()    { return process.env.NEXT_PUBLIC_APP_URL ?? '' },
}
