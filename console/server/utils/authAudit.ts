import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { appendConsoleLoginLog } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

export interface AuthLoginAuditInput {
  uid?: string | null
  identityId?: number | null
  targetApp?: string | null
  authProvider?: string | null
  loginType?: string | null
  loginResult: 'success' | 'failed'
  failureReason?: string | null
  ipAddress?: string | null
  location?: string | null
  deviceSummary?: string | null
  browser?: string | null
  os?: string | null
  sessionId?: string | null
}

function nullableString(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export function getAuthRequestIp(event: H3Event) {
  const forwardedFor = getHeader(event, 'x-forwarded-for')
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  return getHeader(event, 'x-real-ip')
    || event.node.req.socket.remoteAddress
    || null
}

export async function writeAuthLoginEvent(event: H3Event, input: AuthLoginAuditInput) {
  try {
    await appendConsoleLoginLog(event, {
      uid: nullableString(input.uid),
      identityId: input.identityId || null,
      targetApp: nullableString(input.targetApp) || 'console',
      authProvider: nullableString(input.authProvider) || 'local',
      loginType: nullableString(input.loginType) || 'sso',
      loginResult: input.loginResult === 'success' ? 1 : 0,
      failureReason: nullableString(input.failureReason),
      ipAddress: nullableString(input.ipAddress),
      location: nullableString(input.location),
      device: nullableString(input.deviceSummary),
      browser: nullableString(input.browser),
      os: nullableString(input.os),
      sessionId: nullableString(input.sessionId)
    }, `console:auth-login:${crypto.randomUUID()}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[AuthAudit] Failed to write auth_login_events: ${message}`)
  }
}
