import type { H3Event } from 'h3'
import { getCookie, getHeader } from 'h3'
import { resolvePlatformSession, type PlatformSessionContext, type PlatformSessionScope } from '~~/server/utils/platformAuth'

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

export function parseBooleanLike(value: unknown, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value
  }

  const normalized = normalizeString(value).toLowerCase()
  if (!normalized) {
    return defaultValue
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return defaultValue
}

export function parseCsvSet(value: unknown) {
  const normalized = normalizeString(value)
  if (!normalized) {
    return new Set<string>()
  }

  return new Set(
    normalized
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )
}

export function getRequestUid(event: H3Event) {
  return normalizeString(getCookie(event, 'auth_user') || getHeader(event, 'x-hzy-uid'))
}

export function getRequestToken(event: H3Event) {
  const bearer = normalizeString(getHeader(event, 'authorization'))
  if (bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice(7).trim()
  }

  return normalizeString(getCookie(event, 'token'))
}

export function getTenantContextCode(event: H3Event) {
  const headerTenantCode = normalizeString(getHeader(event, 'x-hzy-tenant-code'))
  const cookieTenantCode = normalizeString(getCookie(event, 'hzy-current-tenant'))

  return {
    headerTenantCode,
    cookieTenantCode,
    effectiveTenantCode: headerTenantCode || cookieTenantCode
  }
}

export type AuthenticatedRequestContext = {
  uid: string
  token: string
  session: PlatformSessionContext | null
}

export async function requireAuthenticated(event: H3Event, options: {
  scope?: PlatformSessionScope
} = {}): Promise<AuthenticatedRequestContext> {
  const session = await resolvePlatformSession(event, {
    scope: options.scope
  })
  if (session) {
    return {
      uid: session.uid,
      token: session.sessionUuid,
      session
    }
  }

  if (options.scope) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: `${options.scope} login required`
    })
  }

  const uid = getRequestUid(event)
  const token = getRequestToken(event)

  if (!uid || !token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'login required'
    })
  }

  return {
    uid,
    token,
    session: null
  }
}

export function extractTenantCodeFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const record = payload as Record<string, unknown>
  return normalizeString(record.tenantCode || record.tenant_code)
}
