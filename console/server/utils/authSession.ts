import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, getHeader, setCookie } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { useRuntimeConfig } from '#imports'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { execute, queryRow } from '~~/server/utils/db'
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

interface SessionUserRow extends RowDataPacket {
  sessionPk: number
  storedSessionId: string
  uid: string
  identityId: number | null
  authProvider: string
  issuedAt: string
  lastSeenAt: string | null
  expiresAt: string
  userId: number
  username: string | null
  displayName: string | null
  realName: string | null
  nickname: string | null
  email: string | null
  mobile: string | null
  mobileTail4: string | null
  avatarUrl: string | null
  primaryDeptCode: string | null
  primaryDeptName: string | null
  positionTitle: string | null
  userType: string
  identityProviderCode: string | null
  identityProviderSubject: string | null
}

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

function toSqlDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000)
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

function normalizeUser(row: SessionUserRow): ConsoleAuthUser {
  return {
    id: row.userId,
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

function mapSessionRow(row: SessionUserRow, rawSessionId: string): ConsoleSessionContext {
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
    user: normalizeUser(row),
    identity: {
      providerCode: row.identityProviderCode,
      providerSubject: row.identityProviderSubject
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
  const expiresAt = addSeconds(ttlSeconds)

  await execute(
    `INSERT INTO local_sessions (
       session_id,
       uid,
       identity_id,
       auth_provider,
       ip_address,
       user_agent,
       device_summary,
       issued_at,
       expires_at,
       status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, 'active')`,
    [
      storedSessionId,
      input.uid,
      input.identityId || null,
      input.authProvider || 'local',
      getAuthRequestIp(event),
      String(getHeader(event, 'user-agent') || '').slice(0, 500) || null,
      input.deviceSummary || null,
      toSqlDateTime(expiresAt)
    ]
  )

  setConsoleSessionCookie(event, rawSessionId, ttlSeconds)
  clearConsoleLogoutMarker(event)

  return {
    rawSessionId,
    storedSessionId,
    expiresAt: expiresAt.toISOString(),
    ttlSeconds
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
  const row = await queryRow<SessionUserRow>(
    `SELECT ls.id AS sessionPk,
            ls.session_id AS storedSessionId,
            ls.uid,
            ls.identity_id AS identityId,
            ls.auth_provider AS authProvider,
            ls.issued_at AS issuedAt,
            ls.last_seen_at AS lastSeenAt,
            ls.expires_at AS expiresAt,
            u.id AS userId,
            u.username,
            u.display_name AS displayName,
            u.real_name AS realName,
            u.nickname,
            u.email,
            u.mobile,
            u.mobile_tail4 AS mobileTail4,
            u.avatar_url AS avatarUrl,
            pd.dept_code AS primaryDeptCode,
            pd.dept_name AS primaryDeptName,
            u.position_title AS positionTitle,
            u.user_type AS userType,
            di.provider_code AS identityProviderCode,
            di.provider_subject AS identityProviderSubject
       FROM local_sessions ls
       INNER JOIN directory_users u
          ON u.uid = ls.uid
         AND u.status = 'active'
       LEFT JOIN directory_identities di
          ON di.id = ls.identity_id
       LEFT JOIN (
         SELECT ranked.uid, ranked.dept_code, ranked.dept_name
         FROM (
           SELECT ud.uid,
                  ud.dept_code,
                  d.dept_name,
                  ROW_NUMBER() OVER (
                    PARTITION BY ud.uid
                    ORDER BY ud.is_primary DESC, d.sort_order ASC, d.id ASC, ud.id ASC
                  ) AS row_no
             FROM directory_user_departments ud
             INNER JOIN directory_departments d ON d.dept_code = ud.dept_code
            WHERE ud.status = 'active'
              AND ud.relation_type = 'member'
              AND d.status = 'active'
              AND d.org_type = 'department'
         ) ranked
         WHERE ranked.row_no = 1
       ) pd ON pd.uid = u.uid
      WHERE ls.session_id = ?
        AND ls.status = 'active'
        AND ls.revoked_at IS NULL
        AND ls.expires_at > UTC_TIMESTAMP()
      LIMIT 1`,
    [storedSessionId]
  )

  if (!row) {
    throw createError({ statusCode: 401, message: 'Console session invalid or expired' })
  }

  if (options.touch !== false) {
    await execute(
      `UPDATE local_sessions
          SET last_seen_at = UTC_TIMESTAMP(),
              updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [row.sessionPk]
    )
  }

  return mapSessionRow(row, rawSessionId)
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
    await execute(
      `UPDATE auth_refresh_tokens rt
       INNER JOIN local_sessions ls ON ls.id = rt.session_id
          SET rt.status = 'revoked',
              rt.revoked_at = COALESCE(rt.revoked_at, UTC_TIMESTAMP())
        WHERE ls.session_id = ?
          AND rt.status IN ('active', 'rotated')`,
      [hashConsoleSessionId(rawSessionId)]
    )

    await execute(
      `UPDATE local_sessions
          SET status = 'revoked',
              revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
              updated_at = UTC_TIMESTAMP()
        WHERE session_id = ?
          AND status = 'active'`,
      [hashConsoleSessionId(rawSessionId)]
    )
  }

  if (options.clearCookies !== false) {
    clearConsoleAuthCookies(event)
  }
}
