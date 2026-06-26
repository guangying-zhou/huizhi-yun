import { getRequestHeader, type H3Event } from 'h3'

export function getAuthCookieDomain(event: H3Event): string | undefined {
  const host = getRequestHeader(event, 'x-forwarded-host')
    || getRequestHeader(event, 'host')
    || ''
  const hostname = host.split(':')[0]

  if (!hostname || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return undefined
  }

  const parts = hostname.split('.')
  if (parts.length >= 2) {
    return '.' + parts.slice(-2).join('.')
  }

  return undefined
}

export function getAuthCookieOptions(event: H3Event, overrides: Record<string, unknown> = {}) {
  const domain = getAuthCookieDomain(event)

  return {
    path: '/',
    sameSite: 'lax' as const,
    ...(domain ? { domain } : {}),
    ...overrides
  }
}
