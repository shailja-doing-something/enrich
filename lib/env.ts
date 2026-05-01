function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function optional(name: string): string {
  return process.env[name] ?? ''
}

export const env = {
  get NEXT_PUBLIC_SUPABASE_URL() { return required('NEXT_PUBLIC_SUPABASE_URL') },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() { return required('NEXT_PUBLIC_SUPABASE_ANON_KEY') },
  get SUPABASE_SERVICE_ROLE_KEY() { return required('SUPABASE_SERVICE_ROLE_KEY') },
  get GEMINI_API_KEY() { return required('GEMINI_API_KEY') },
  get HUBSPOT_API_KEY() { return optional('HUBSPOT_API_KEY') },
  get N8N_ZILLOW_WEBHOOK_URL() { return optional('N8N_ZILLOW_WEBHOOK_URL') },
  get N8N_WEBHOOK_SECRET() { return optional('N8N_WEBHOOK_SECRET') },
  get TEAM_SIZE_SERVICE_URL() { return optional('TEAM_SIZE_SERVICE_URL') },
  get ZILLOW_ZIP_API_KEY() { return optional('ZILLOW_ZIP_API_KEY') },
  get STAGE2_DB_URL() { return optional('STAGE2_DB_URL') },
  get STAGE3_SCRAPE_URL() { return optional('STAGE3_SCRAPE_URL') },
}
