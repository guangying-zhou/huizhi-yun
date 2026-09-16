import { getCookie, getHeader, getQuery, type H3Event } from 'h3'
import { execute } from './db'

type LoginType = 'password' | 'sso' | 'oauth'

interface LoginLogPayload {
  uid?: string | null
  targetApp?: string | null
  loginType: LoginType
  loginResult: 0 | 1
  failureReason?: string | null
  sessionId?: string | null
  ipAddress?: string | null
  device?: string | null
  browser?: string | null
  os?: string | null
}

interface OperationLogPayload {
  userId?: number | null
  uid?: string | null
  sourceApp?: string
  sessionId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | number | null
  detail?: string | Record<string, unknown> | null
  result?: 'success' | 'failed'
  ipAddress?: string | null
}

interface EventActor {
  userId: number | null
  uid: string | null
  ipAddress: string | null
  sessionId: string | null
}

function getLoginTargetApp(event: H3Event, explicitTargetApp?: string | null): string {
  if (explicitTargetApp && explicitTargetApp.trim()) {
    return explicitTargetApp.trim()
  }

  const query = getQuery(event)
  const queryTargetApp = typeof query.target_app === 'string' ? query.target_app : ''
  if (queryTargetApp.trim()) {
    return queryTargetApp.trim()
  }

  const headerTargetApp = getHeader(event, 'x-target-app') || ''
  if (headerTargetApp.trim()) {
    return headerTargetApp.trim()
  }

  return 'account'
}

function getRequestIp(event: H3Event): string | null {
  const forwardedFor = getHeader(event, 'x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null
  }

  const realIp = getHeader(event, 'x-real-ip')
  if (realIp) return realIp

  return event.node.req.socket.remoteAddress || null
}

function getRequestSessionId(event: H3Event): string | null {
  const headerSessionId = getHeader(event, 'x-session-id') || ''
  if (headerSessionId.trim()) return headerSessionId.trim()

  const token = getCookie(event, 'token')
  if (token && token.trim()) return token.trim()

  return null
}

function getRequestUserAgent(event: H3Event): string {
  return getHeader(event, 'user-agent') || ''
}

function detectBrowser(userAgent: string): string | null {
  if (!userAgent) return null
  if (/Edg\//i.test(userAgent)) return 'Edge'
  if (/Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent)) return 'Chrome'
  if (/Firefox\//i.test(userAgent)) return 'Firefox'
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return 'Safari'
  if (/MicroMessenger/i.test(userAgent)) return 'WeChat'
  return null
}

function detectOs(userAgent: string): string | null {
  if (!userAgent) return null
  if (/Windows/i.test(userAgent)) return 'Windows'
  if (/Mac OS X/i.test(userAgent)) return 'macOS'
  if (/Android/i.test(userAgent)) return 'Android'
  if (/(iPhone|iPad|iPod)/i.test(userAgent)) return 'iOS'
  if (/Linux/i.test(userAgent)) return 'Linux'
  return null
}

function detectDevice(userAgent: string): string | null {
  if (!userAgent) return null
  if (/(iPhone|Android.+Mobile)/i.test(userAgent)) return 'Mobile'
  if (/(iPad|Tablet|Android(?!.*Mobile))/i.test(userAgent)) return 'Tablet'
  return 'Desktop'
}

function serializeOperationDetail(payload: OperationLogPayload): string {
  const sourceApp = payload.sourceApp || 'account'
  const result = payload.result || 'success'
  const rawDetail = payload.detail

  if (typeof rawDetail === 'string') {
    return JSON.stringify({
      sourceApp,
      targetType: payload.targetType || null,
      targetId: payload.targetId != null ? String(payload.targetId) : null,
      result,
      message: rawDetail
    })
  }

  return JSON.stringify({
    sourceApp,
    sessionId: payload.sessionId || null,
    targetType: payload.targetType || null,
    targetId: payload.targetId != null ? String(payload.targetId) : null,
    result,
    ...(rawDetail || {})
  })
}

export function getEventActor(event: H3Event): EventActor {
  const authId = getCookie(event, 'auth_id')
  const authUser = getCookie(event, 'auth_user')

  return {
    userId: authId && !Number.isNaN(Number(authId)) ? Number(authId) : null,
    uid: authUser || null,
    ipAddress: getRequestIp(event),
    sessionId: getRequestSessionId(event)
  }
}

export async function logLogin(payload: LoginLogPayload) {
  try {
    await execute(
      `INSERT INTO login_logs (uid, target_app, login_type, login_result, failure_reason, ip_address, device, browser, os, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.uid || null,
        payload.targetApp || 'account',
        payload.loginType,
        payload.loginResult,
        payload.failureReason || null,
        payload.ipAddress || null,
        payload.device || null,
        payload.browser || null,
        payload.os || null,
        payload.sessionId || null
      ]
    )
  } catch (error) {
    console.error('Failed to log login:', error)
  }
}

export async function logLoginFromEvent(event: H3Event, payload: Omit<LoginLogPayload, 'ipAddress' | 'device' | 'browser' | 'os'>) {
  const userAgent = getRequestUserAgent(event)

  await logLogin({
    ...payload,
    targetApp: getLoginTargetApp(event, payload.targetApp),
    ipAddress: getRequestIp(event),
    device: detectDevice(userAgent),
    browser: detectBrowser(userAgent),
    os: detectOs(userAgent)
  })
}

export async function logOperation(payload: OperationLogPayload) {
  try {
    await execute(
      'INSERT INTO operation_logs (user_id, uid, source_app, session_id, action, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        payload.userId || null,
        payload.uid || null,
        payload.sourceApp || 'account',
        payload.sessionId || null,
        payload.action,
        serializeOperationDetail(payload),
        payload.ipAddress || null
      ]
    )
  } catch (error) {
    console.error('Failed to log operation:', error)
  }
}

export async function logOperationFromEvent(event: H3Event, payload: Omit<OperationLogPayload, 'userId' | 'uid' | 'ipAddress'> & { userId?: number | null, uid?: string | null }) {
  const actor = getEventActor(event)

  await logOperation({
    ...payload,
    userId: payload.userId ?? actor.userId,
    uid: payload.uid ?? actor.uid,
    sessionId: payload.sessionId ?? actor.sessionId,
    ipAddress: actor.ipAddress
  })
}
