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
  appCode?: string
  clientCode?: string
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
  const legacyAuthBridge = getConfigValue(event, [
    'hzy.legacyAuthBridge',
    'legacyAuthBridge',
    'public.legacyAuthBridge'
  ]) || process.env.HZY_LEGACY_AUTH_BRIDGE || ''

  return legacyAuthModeIsEnabled(authMode, legacyAuthBridge)
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

export type WorkflowProxyActor = {
  uid: string
  sourceApp: string
}

function validDelegatedUid(uid: string) {
  return Boolean(uid)
    && uid.length <= 191
    && ![...uid].some((character) => {
      const code = character.codePointAt(0) || 0
      return code < 32 || code === 127
    })
}

/**
 * The Workflow proxy's source app is a security boundary, not display data.
 * Foundation writes this header from its server-side app config while Console
 * signs the same app identity into the service token.  A browser cannot select
 * either value independently.
 */
export function getTrustedWorkflowProxyActor(event: H3Event, auth = getWorkflowConsoleAuth(event)): WorkflowProxyActor | null {
  if (!auth?.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') return null
  const scopes = serviceScopes(auth)
  const sourceApp = String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/u, '')
  const declaredApp = String(getHeader(event, 'x-hzy-request-app-code') || '').trim()
  const uid = String(getHeader(event, 'x-hzy-actor-uid') || '').trim()
  if (!scopes.has('workflow:proxy') || !sourceApp || declaredApp !== sourceApp || !validDelegatedUid(uid)) return null
  return { uid, sourceApp }
}

function proxiedActorUid(event: H3Event, auth: ConsoleAuthContext | undefined) {
  return getTrustedWorkflowProxyActor(event, auth)?.uid || ''
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

/**
 * `/api/account/**` is a legacy browser-path namespace and does not pass
 * through the `/api/v1/**` tenant-runtime middleware. Resolve the Console
 * session before a compatibility route can inspect configuration, read a
 * request body, or use Workflow's Directory adapter credentials.
 */
export async function requireWorkflowSessionUid(event: H3Event, message = '请先登录') {
  await ensureWorkflowConsoleAuth(event)
  return requireRequestUid(event, message)
}

/**
 * Compatibility relationship reads are self-service only. A caller-provided
 * UID must never choose another user's Directory relations. Omitting the UID
 * is retained for old clients and resolves to the verified current subject.
 */
export async function requireCurrentWorkflowSessionUid(
  event: H3Event,
  requestedUid: unknown,
  message = '无权访问其他用户的目录关系'
) {
  const actorUid = await requireWorkflowSessionUid(event)
  const targetUid = String(requestedUid || '').trim()
  if (targetUid && targetUid !== actorUid) {
    throw createError({ statusCode: 403, message })
  }
  return actorUid
}
