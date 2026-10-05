import { createError, getCookie, type H3Event } from 'h3'
import { resolveConsoleAuthWithSessionBridge } from '@hzy/foundation/server/utils/consoleSessionBridge'

type ConsoleAuthContext = {
  authenticated?: boolean
  reason?: string
  token?: string
  tokenUse?: string
  subjectType?: string
  uid?: string
  subjectCode?: string
  tenant?: string
  deployment?: string
  policyVersion?: string
  scopes?: string[]
  claims?: Record<string, unknown>
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

export function isLegacyAuthEnabled(event: H3Event) {
  const authMode = getConfigValue(event, [
    'hzy.authMode',
    'authMode',
    'public.authMode'
  ]) || process.env.HZY_AUTH_MODE || ''

  return authMode === 'legacy'
    || String(process.env.HZY_LEGACY_AUTH_BRIDGE || '').toLowerCase() === 'true'
}

export function getAssetsConsoleAuth(event: H3Event) {
  return event.context.consoleAuth as ConsoleAuthContext | undefined
}

export async function ensureAssetsConsoleAuth(event: H3Event) {
  const existing = getAssetsConsoleAuth(event)
  if (existing && ('authenticated' in existing || 'reason' in existing)) return existing

  const resolved = await resolveConsoleAuthWithSessionBridge(event)
  event.context.consoleAuth = resolved
  return resolved
}

export function getRequestUid(event: H3Event) {
  const consoleAuth = getAssetsConsoleAuth(event)
  const verifiedUid = String(consoleAuth?.uid || '').trim()

  if (consoleAuth?.authenticated && verifiedUid) {
    return verifiedUid
  }

  if (isLegacyAuthEnabled(event)) {
    return String(getCookie(event, 'auth_user') || '').trim()
  }

  return ''
}

export function requireRequestUid(event: H3Event, message = '请先登录') {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message })
  }
  return uid
}

/**
 * `/api/account/**` remains a legacy browser-path namespace and is not
 * covered by the `/api/v1/**` tenant-runtime middleware. Resolve the Console
 * session before such routes can use this application's Directory adapter.
 */
export async function requireAssetsSessionUid(event: H3Event, message = '请先登录') {
  await ensureAssetsConsoleAuth(event)
  return requireRequestUid(event, message)
}

/**
 * Compatibility relationship reads are self-service only. A caller-provided
 * UID must never select a different user's Directory relations.
 */
export async function requireCurrentAssetsSessionUid(
  event: H3Event,
  requestedUid: unknown,
  message = '无权访问其他用户的目录关系'
) {
  const actorUid = await requireAssetsSessionUid(event)
  const targetUid = String(requestedUid || '').trim()
  if (targetUid && targetUid !== actorUid) {
    throw createError({ statusCode: 403, message })
  }
  return actorUid
}
