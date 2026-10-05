function normalizeDomain(domain: string | null | undefined): string {
  return String(domain || '').trim().toLowerCase().replace(/^@+/, '')
}

function normalizeEmail(email: string | null | undefined): string | null {
  const value = String(email || '').trim().toLowerCase()
  return value || null
}

function extractLocalPart(value: string | null | undefined): string | null {
  const normalized = normalizeEmail(value)
  if (!normalized) return null

  const source = normalized.includes('@') ? normalized.split('@')[0] : normalized
  if (!source) return null
  const localPart = source.replace(/[^a-z0-9._-]/g, '')
  return localPart || null
}

export function isCompanyEmail(email: string | null | undefined, domain: string | null | undefined): boolean {
  const normalizedEmail = normalizeEmail(email)
  const normalizedDomain = normalizeDomain(domain)

  if (!normalizedEmail || !normalizedDomain) return false
  return normalizedEmail.endsWith(`@${normalizedDomain}`)
}

export function buildCompanyEmail(domain: string | null | undefined, ...candidates: Array<string | null | undefined>): string | null {
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedDomain) return null

  for (const candidate of candidates) {
    const localPart = extractLocalPart(candidate)
    if (localPart) {
      return `${localPart}@${normalizedDomain}`
    }
  }

  return null
}

export function resolveSyncedEmail(options: {
  currentEmail?: string | null
  sourceEmail?: string | null
  companyDomain?: string | null
  fallbackUid?: string | null
}): string | null {
  const currentEmail = normalizeEmail(options.currentEmail)
  const sourceEmail = normalizeEmail(options.sourceEmail)
  const companyDomain = normalizeDomain(options.companyDomain)

  if (!companyDomain) return sourceEmail || currentEmail || null

  if (isCompanyEmail(sourceEmail, companyDomain)) {
    return sourceEmail
  }

  if (!currentEmail || !isCompanyEmail(currentEmail, companyDomain)) {
    return buildCompanyEmail(companyDomain, options.fallbackUid, sourceEmail)
  }

  return currentEmail
}
