import { createError, getCookie, type H3Event } from 'h3'

type ConsoleAuthContext = {
  authenticated?: boolean
  uid?: string
  subjectCode?: string
  tenant?: string
  policyVersion?: string
}

function getConfigValue(event: H3Event, keys: string[]) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>

  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }

    if (current !== undefined && current !== null && String(current).trim()) {
      return String(current).trim()
    }
  }

  return ''
}

export function legacyAuthModeIsEnabled(authMode: unknown, legacyAuthBridge: unknown) {
  return String(authMode || '').trim() === 'legacy'
    || String(legacyAuthBridge || '').trim().toLowerCase() === 'true'
}

export function isLegacyAuthEnabled(event: H3Event) {
  const authMode = getConfigValue(event, [
    'hzy.authMode',
    'authMode',
    'public.authMode'
  ]) || process.env.HZY_AUTH_MODE || ''

  return legacyAuthModeIsEnabled(authMode, process.env.HZY_LEGACY_AUTH_BRIDGE)
}

export function getCodocsConsoleAuth(event: H3Event) {
  return event.context.consoleAuth as ConsoleAuthContext | undefined
}

export function getRequestUid(event: H3Event) {
  const consoleAuth = getCodocsConsoleAuth(event)
  const verifiedUid = String(consoleAuth?.uid || '').trim()

  if (consoleAuth?.authenticated && verifiedUid) {
    return verifiedUid
  }

  if (isLegacyAuthEnabled(event)) {
    return String(getCookie(event, 'auth_user') || '').trim()
  }

  return ''
}

export function getRequestDisplayName(event: H3Event) {
  const uid = getRequestUid(event)
  return String(getCookie(event, 'auth_realname') || uid).trim() || uid
}

export function requireRequestUid(event: H3Event, message = '请先登录') {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message })
  }
  return uid
}

/**
 * Compatibility directory endpoints must not use the application's Console
 * directory access as an arbitrary-user lookup proxy. Keep self-service
 * compatibility reads bound to the verified request subject.
 */
export function requireCurrentRequestUid(event: H3Event, requestedUid: unknown, message = '无权访问其他用户的目录关系') {
  const actorUid = requireRequestUid(event)
  const targetUid = String(requestedUid || '').trim()
  if (!targetUid || targetUid !== actorUid) {
    throw createError({ statusCode: 403, message })
  }
  return actorUid
}
