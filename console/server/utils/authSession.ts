import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, getHeader, setCookie } from 'h3'
import { useRuntimeConfig } from '#imports'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import {
  issueConsoleAuthSession,
  resolveConsoleAuthSession,
  revokeConsoleAuthSession,
  type ConsoleRuntimeSession
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getAuthRequestIp } from '~~/server/utils/authAudit'

export const CONSOLE_SESSION_COOKIE = 'console_session'
export const CONSOLE_LOGOUT_MARKER_COOKIE = 'console_logged_out'

const LEGACY_AUTH_COOKIES = [
  'token',
  'auth_user',
  'auth_email',
  'auth_role',
  'auth_realname',
  'auth_real_name',
  'real_name',
  'auth_nickname',
  'auth_avatar',
  'auth_department',
  'auth_dept_code',
  'auth_mobile_tail4'
]

export interface ConsoleAuthUser {
  id?: number
  uid: string
  username?: string | null
  displayName?: string | null
  realName?: string | null
  nickname?: string | null
  email?: string | null
  mobile?: string | null
  mobileTail4?: string | null
  avatar?: string | null
  avatarUrl?: string | null
  deptCode?: string | null
  deptName?: string | null
  primaryDeptCode?: string | null
  primaryDeptName?: string | null
  positionTitle?: string | null
  userType?: string | null
}

export interface ConsoleSessionContext {
  sessionPk: number
  sessionId: string
  storedSessionId: string
  uid: string
  identityId: number | null
  authProvider: string
  issuedAt: string
  lastSeenAt: string | null
  expiresAt: string
  user: ConsoleAuthUser
  identity: {
    providerCode: string | null
    providerSubject: string | null
  }
}

function isHttps(event: H3Event) {
  const proto = String(getHeader(event, 'x-forwarded-proto') || '').toLowerCase()
  return proto === 'https'
}

function getSessionTtlSeconds(event: H3Event) {
  const config = useRuntimeConfig(event)
  const configured = Number(config.auth?.sessionTtlSeconds || process.env.CONSOLE_AUTH_SESSION_TTL_SECONDS || 28800)
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 28800
}

function getAuthCookieMode(event: H3Event) {
  const config = useRuntimeConfig(event)
  return String(config.auth?.cookieMode || process.env.CONSOLE_AUTH_COOKIE_MODE || 'dual').trim().toLowerCase()
}

function allowLegacyCookieFallback(event: H3Event) {
  const config = useRuntimeConfig(event)
  const configured = config.auth?.legacyCookieFallback
  if (typeof configured === 'boolean') return configured
  return process.env.AUTH_LEGACY_COOKIE_FALLBACK !== 'false'
}

export function shouldWriteLegacyAuthCookies(event: H3Event) {
  const mode = getAuthCookieMode(event)
  return mode === 'dual' || mode === 'legacy'
}

function createRawSessionId() {
  return `cs_${randomBytes(32).toString('base64url')}`
}

export function hashConsoleSessionId(rawSessionId: string) {
  const normalized = String(rawSessionId || '').trim()
  if (!normalized) return ''
  if (normalized.startsWith('sha256_')) return normalized
  return `sha256_${createHash('sha256').update(normalized).digest('hex')}`
}

function sessionCookieOptions(event: H3Event, maxAge?: number) {
  return getAuthCookieOptions(event, {
    httpOnly: true,
    secure: isHttps(event),
    ...(typeof maxAge === 'number' ? { maxAge } : {})
  })
}

function legacyCookieOptions(event: H3Event, maxAge?: number) {
  return getAuthCookieOptions(event, {
    secure: isHttps(event),
    ...(typeof maxAge === 'number' ? { maxAge } : {})
  })
}

function getMobileTail(value: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : ''
}

function userDisplayName(user: ConsoleAuthUser) {
  return user.realName || user.displayName || user.username || user.uid
}

function normalizeUser(row: ConsoleRuntimeSession['user']): ConsoleAuthUser {
  return {
    id: row.id,
    uid: row.uid,
    username: row.username,
    displayName: row.displayName,
    realName: row.realName || row.displayName || row.username || row.uid,
    nickname: row.nickname,
    email: row.email,
    mobile: row.mobile,
    mobileTail4: row.mobileTail4 || getMobileTail(row.mobile),
    avatar: row.avatarUrl,
    avatarUrl: row.avatarUrl,
    deptCode: row.primaryDeptCode,
    deptName: row.primaryDeptName,
    primaryDeptCode: row.primaryDeptCode,
    primaryDeptName: row.primaryDeptName,
    positionTitle: row.positionTitle,
    userType: row.userType
  }
}

function mapSessionRow(row: ConsoleRuntimeSession, rawSessionId: string): ConsoleSessionContext {
  return {
    sessionPk: row.sessionPk,
    sessionId: rawSessionId,
    storedSessionId: row.storedSessionId,
    uid: row.uid,
    identityId: row.identityId,
    authProvider: row.authProvider,
    issuedAt: row.issuedAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    user: normalizeUser(row.user),
    identity: {
      providerCode: row.identity.providerCode,
      providerSubject: row.identity.providerSubject
    }
  }
}

export function setConsoleSessionCookie(event: H3Event, rawSessionId: string, ttlSeconds = getSessionTtlSeconds(event)) {
  setCookie(event, CONSOLE_SESSION_COOKIE, rawSessionId, sessionCookieOptions(event, ttlSeconds))
}

export function writeLegacyAuthCookies(event: H3Event, rawSessionId: string, user: ConsoleAuthUser, ttlSeconds = getSessionTtlSeconds(event)) {
  const options = legacyCookieOptions(event, ttlSeconds)
  const displayName = userDisplayName(user)
  const deptCode = user.primaryDeptCode || user.deptCode || ''
  const deptName = user.primaryDeptName || user.deptName || ''
  const mobileTail4 = user.mobileTail4 || getMobileTail(user.mobile)

  setCookie(event, 'token', rawSessionId, options)
  setCookie(event, 'auth_user', user.uid, options)
  if (user.email) setCookie(event, 'auth_email', user.email, options)
  if (displayName) {
    setCookie(event, 'auth_realname', displayName, options)
    setCookie(event, 'auth_real_name', displayName, options)
    setCookie(event, 'real_name', displayName, options)
  }
  if (user.nickname) setCookie(event, 'auth_nickname', user.nickname, options)
  if (user.avatar || user.avatarUrl) setCookie(event, 'auth_avatar', user.avatar || user.avatarUrl || '', options)
  if (deptName) setCookie(event, 'auth_department', deptName, options)
  if (deptCode) setCookie(event, 'auth_dept_code', deptCode, options)
  if (mobileTail4) setCookie(event, 'auth_mobile_tail4', mobileTail4, options)
}

export function clearConsoleAuthCookies(event: H3Event) {
  deleteCookie(event, CONSOLE_SESSION_COOKIE, sessionCookieOptions(event, 0))
  for (const name of LEGACY_AUTH_COOKIES) {
    deleteCookie(event, name, legacyCookieOptions(event, 0))
  }
}

export function setConsoleLogoutMarker(event: H3Event) {
  setCookie(event, CONSOLE_LOGOUT_MARKER_COOKIE, '1', legacyCookieOptions(event))
}

export function hasConsoleLogoutMarker(event: H3Event) {
  return String(getCookie(event, CONSOLE_LOGOUT_MARKER_COOKIE) || '').trim() === '1'
}

export function clearConsoleLogoutMarker(event: H3Event) {
  deleteCookie(event, CONSOLE_LOGOUT_MARKER_COOKIE, legacyCookieOptions(event, 0))
}

export async function createConsoleSession(
  event: H3Event,
  input: {
    uid: string
    identityId?: number | null
    authProvider: string
    ttlSeconds?: number
    deviceSummary?: string | null
  }
) {
  const ttlSeconds = input.ttlSeconds || getSessionTtlSeconds(event)
  const rawSessionId = createRawSessionId()
  const storedSessionId = hashConsoleSessionId(rawSessionId)
  const issued = await issueConsoleAuthSession(event, {
    sessionIdHash: storedSessionId,
    uid: input.uid,
    identityId: input.identityId || null,
    authProvider: input.authProvider || 'local',
    ipAddress: getAuthRequestIp(event),
    userAgent: String(getHeader(event, 'user-agent') || '').slice(0, 500) || null,
    deviceSummary: input.deviceSummary || null,
    ttlSeconds
  }, `console:auth-session:issue:${crypto.randomUUID()}`)

  setConsoleSessionCookie(event, rawSessionId, ttlSeconds)
  clearConsoleLogoutMarker(event)

  return {
    rawSessionId,
    storedSessionId: issued.data.storedSessionId,
    expiresAt: issued.data.expiresAt,
    ttlSeconds: issued.data.ttlSeconds
  }
}

export function readConsoleSessionCookie(event: H3Event, options: { allowLegacyFallback?: boolean } = {}) {
  const sessionCookie = String(getCookie(event, CONSOLE_SESSION_COOKIE) || '').trim()
  if (sessionCookie) return sessionCookie

  const shouldFallback = options.allowLegacyFallback ?? allowLegacyCookieFallback(event)
  if (shouldFallback) {
    const legacyToken = String(getCookie(event, 'token') || '').trim()
    if (legacyToken) return legacyToken
  }

  return ''
}

export async function resolveConsoleSession(
  event: H3Event,
  options: { allowLegacyFallback?: boolean, touch?: boolean } = {}
): Promise<ConsoleSessionContext> {
  const rawSessionId = readConsoleSessionCookie(event, options)
  if (!rawSessionId) {
    throw createError({ statusCode: 401, message: 'Console login required' })
  }

  const storedSessionId = hashConsoleSessionId(rawSessionId)
  const resolved = await resolveConsoleAuthSession(event, {
    sessionIdHash: storedSessionId,
    touch: options.touch !== false
  })
  return mapSessionRow(resolved.data, rawSessionId)
}

export async function resolveOptionalConsoleSession(event: H3Event, options: { allowLegacyFallback?: boolean, touch?: boolean } = {}) {
  try {
    return await resolveConsoleSession(event, options)
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error && Number((error as { statusCode?: unknown }).statusCode) === 401) {
      return null
    }
    throw error
  }
}

export async function revokeConsoleSession(event: H3Event, options: { clearCookies?: boolean } = {}) {
  const rawSessionId = readConsoleSessionCookie(event)
  if (rawSessionId) {
    await revokeConsoleAuthSession(
      event,
      { sessionIdHash: hashConsoleSessionId(rawSessionId) },
      `console:auth-session:revoke:${crypto.randomUUID()}`
    )
  }

  if (options.clearCookies !== false) {
    clearConsoleAuthCookies(event)
  }
}
