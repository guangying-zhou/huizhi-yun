import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { execute } from '~~/server/utils/db'

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

export async function writeAuthLoginEvent(input: AuthLoginAuditInput) {
  try {
    await execute(
      `INSERT INTO auth_login_events (
         uid,
         identity_id,
         target_app,
         auth_provider,
         login_type,
         login_result,
         failure_reason,
         ip_address,
         location,
         device_summary,
         browser,
         os,
         session_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nullableString(input.uid),
        input.identityId || null,
        nullableString(input.targetApp),
        nullableString(input.authProvider) || 'local',
        nullableString(input.loginType) || 'sso',
        input.loginResult,
        nullableString(input.failureReason),
        nullableString(input.ipAddress),
        nullableString(input.location),
        nullableString(input.deviceSummary),
        nullableString(input.browser),
        nullableString(input.os),
        nullableString(input.sessionId)
      ]
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[AuthAudit] Failed to write auth_login_events: ${message}`)
  }
}
