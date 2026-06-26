import { resolveConsoleAuthWithSessionBridge } from '@hzy/foundation/server/utils/consoleSessionBridge'
import { createError, getCookie, getHeader, type H3Event } from 'h3'

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
  claims?: {
    scope?: unknown
  }
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
  const consoleOidcIssuer = getConfigValue(event, [
    'hzy.consoleOidc.issuer',
    'consoleOidc.issuer',
    'public.consoleUrl',
    'hzy.directory.consoleApiUrl'
  ])

  return authMode === 'legacy'
    || String(process.env.HZY_LEGACY_AUTH_BRIDGE || '').toLowerCase() === 'true'
    || !consoleOidcIssuer
}

export function getWorkflowConsoleAuth(event: H3Event) {
  return event.context.consoleAuth as ConsoleAuthContext | undefined
}

export async function ensureWorkflowConsoleAuth(event: H3Event) {
  const existing = getWorkflowConsoleAuth(event)
  if (existing?.authenticated) return existing

  const resolved = await resolveConsoleAuthWithSessionBridge(event)
  event.context.consoleAuth = resolved
  return resolved
}

function serviceScopes(auth: ConsoleAuthContext | undefined) {
  const fromContext = Array.isArray(auth?.scopes) ? auth.scopes : []
  const fromClaims = String(auth?.claims?.scope || '')
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)
  return new Set([...fromContext, ...fromClaims])
}

function proxiedActorUid(event: H3Event, auth: ConsoleAuthContext | undefined) {
  if (!auth?.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') return ''
  if (!serviceScopes(auth).has('workflow:proxy')) return ''
  return String(getHeader(event, 'x-hzy-actor-uid') || '').trim()
}

export function getRequestUid(event: H3Event) {
  const consoleAuth = getWorkflowConsoleAuth(event)
  const verifiedUid = String(consoleAuth?.uid || '').trim()

  if (consoleAuth?.authenticated && verifiedUid) {
    return verifiedUid
  }

  const actorUid = proxiedActorUid(event, consoleAuth)
  if (actorUid) return actorUid

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
