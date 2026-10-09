import { createError, getCookie, type H3Event } from 'h3'
import { requireFoundationSessionUid } from '@hzy/foundation/server/utils/authIdentity'
import { verifiedServiceCommandActor } from '@hzy/foundation/server/utils/tenantRuntimeClient'

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

export function isLegacyAuthEnabled(event: H3Event) {
  const authMode = getConfigValue(event, [
    'hzy.authMode',
    'authMode',
    'public.authMode'
  ]) || process.env.HZY_AUTH_MODE || ''

  return authMode === 'legacy'
    || String(process.env.HZY_LEGACY_AUTH_BRIDGE || '').toLowerCase() === 'true'
}

export function getAimsConsoleAuth(event: H3Event) {
  return event.context.consoleAuth as ConsoleAuthContext | undefined
}

export function getRequestUid(event: H3Event) {
  const delegated = verifiedServiceCommandActor(event, 'aims')
  if (delegated) return delegated.uid
  const consoleAuth = getAimsConsoleAuth(event)
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
 * `/api/account/**` compatibility routes do not pass through the Aims
 * tenant-runtime middleware. Resolve the Console session here before using
 * the application's Directory or integration credentials, so these routes
 * cannot become anonymous Directory proxies.
 */
export async function requireAimsSessionUid(event: H3Event, message = '请先登录') {
  return await requireFoundationSessionUid(event, message)
}

/**
 * Compatibility directory relationship reads are self-service only. The
 * caller supplied UID must never select another user's Directory relations.
 */
export async function requireCurrentAimsSessionUid(
  event: H3Event,
  requestedUid: unknown,
  message = '无权访问其他用户的目录关系'
) {
  const actorUid = await requireAimsSessionUid(event)
  const targetUid = String(requestedUid || '').trim()
  if (!targetUid || targetUid !== actorUid) {
    throw createError({ statusCode: 403, message })
  }
  return actorUid
}
