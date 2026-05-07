export function cleanPhone(raw: string): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length > 10) return digits.slice(-10)
  if (digits.length < 7) return ''
  return digits
}

export function cleanEmail(raw: string): string {
  return (raw ?? '').trim().toLowerCase()
}

export function cleanName(raw: string): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ')
}
