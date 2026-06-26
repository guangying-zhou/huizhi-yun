const OIDC_CALLBACK_PATH = '/api/auth/oidc-callback'
const OIDC_LOGOUT_PATH = '/api/auth/logout'

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

export function normalizePublicUrl(value: unknown) {
  const normalized = normalizeString(value).replace(/\/+$/, '')
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function defaultAppBasePath(appCode: unknown) {
  const code = normalizeString(appCode)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return code ? `/${code}/` : '/'
}

export function normalizeBasePath(value: unknown) {
  const normalized = normalizeString(value)
  if (!normalized) return null
  if (normalized === '/') return '/'
  if (!normalized.startsWith('/')) return null
  if (normalized.includes('://') || normalized.includes('?') || normalized.includes('#')) return null
  if (/\s/.test(normalized) || normalized.includes('..') || normalized.includes('//')) return null
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

export function defaultApiBase(appCode: unknown) {
  const code = normalizeString(appCode)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return code ? `/api/v1/${code}` : '/api/v1'
}

export function normalizeApiBase(value: unknown, appCode?: unknown) {
  const normalized = normalizeString(value)
  if (!normalized) return defaultApiBase(appCode)
  if (!normalized.startsWith('/') || normalized.includes('://') || normalized.includes('?') || normalized.includes('#') || /\s/.test(normalized) || normalized.includes('..') || normalized.includes('//')) {
    return defaultApiBase(appCode)
  }
  return normalized.replace(/\/+$/, '') || defaultApiBase(appCode)
}

export function buildAppHomeUrl(publicUrl: unknown, basePath: unknown) {
  const origin = normalizePublicUrl(publicUrl)
  const path = normalizeBasePath(basePath)
  if (!origin || !path) return null

  return `${origin}${path === '/' ? '/' : path}`
}

export function deriveOidcCallbackUrl(homeUrl: unknown) {
  const normalized = normalizeString(homeUrl)
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    url.search = ''
    url.hash = ''

    return `${url.toString().replace(/\/+$/, '')}${OIDC_CALLBACK_PATH}`
  } catch {
    return null
  }
}

export function resolveOidcCallbackUrl(callbackUrl: unknown, homeUrl: unknown) {
  return normalizeString(callbackUrl) || deriveOidcCallbackUrl(homeUrl)
}

export function deriveLogoutUrl(homeUrl: unknown) {
  const normalized = normalizeString(homeUrl)
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    url.search = ''
    url.hash = ''

    return `${url.toString().replace(/\/+$/, '')}${OIDC_LOGOUT_PATH}`
  } catch {
    return null
  }
}
