import { createError } from 'h3'
import type { JWTPayload } from 'jose'

interface ServiceTokenClaims extends JWTPayload {
  scope?: string
  token_use?: string
  client_id?: string
  tenant?: string | null
  deployment?: string | null
  source_app?: string | null
  target_app?: string | null
  hzy?: {
    clientCode?: string
    appCode?: string | null
  }
}

export interface ConsoleServiceActor {
  actorType: 'service'
  actorId: string
  appCode: string | null
  tenantCode: string | null
  deploymentCode: string | null
}

export function consoleServiceActorContext(
  actor: ConsoleServiceActor,
  requiredScope: string,
  existing: Record<string, unknown> = {}
) {
  return {
    ...existing,
    authenticated: true,
    uid: null,
    subjectType: 'service',
    tokenUse: 'service',
    appCode: actor.appCode,
    clientCode: actor.actorId,
    scopes: [requiredScope],
    tenant: actor.tenantCode,
    deployment: actor.deploymentCode
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function errorStatus(error: unknown) {
  const candidate = error as {
    statusCode?: unknown
    status?: unknown
    response?: { status?: unknown }
  }
  return Number(candidate?.statusCode || candidate?.status || candidate?.response?.status || 0)
}

function normalizedAppCode(value: unknown) {
  const code = stringValue(value).toLowerCase()
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(code) ? code : ''
}

export function assertNotificationPublisherIdentity(
  actor: {
    actorType?: string
    actorId: string | null
    appCode?: string | null
    tenantCode?: string | null
    deploymentCode?: string | null
  },
  binding: { tenantId: string, deploymentId: string }
) {
  const appCode = normalizedAppCode(actor.appCode)
  const actorId = stringValue(actor.actorId)
  if (actor.actorType !== 'service' || !actorId || !appCode || !actor.tenantCode || !actor.deploymentCode) {
    throw createError({ statusCode: 403, message: 'notification publisher identity is incomplete' })
  }
  if (actor.tenantCode !== binding.tenantId || actor.deploymentCode !== binding.deploymentId) {
    throw createError({ statusCode: 403, message: 'notification publisher runtime binding mismatch' })
  }
  return { ...actor, actorType: 'service' as const, actorId, appCode }
}

export async function authorizeConsoleServiceActor(input: {
  authorization: string
  audience: string
  requiredScope: string
  requireBoundTargetApp?: boolean
  verify: (token: string, audience: string) => Promise<JWTPayload>
}): Promise<ConsoleServiceActor> {
  const match = stringValue(input.authorization).match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) {
    throw createError({ statusCode: 401, message: 'invalid_token: bearer token is required' })
  }

  let payload: JWTPayload
  try {
    payload = await input.verify(match[1], input.audience)
  } catch (error) {
    if (errorStatus(error) === 401) {
      throw createError({ statusCode: 401, message: 'invalid_token' })
    }
    throw createError({ statusCode: 503, message: 'service_token_verification_unavailable' })
  }

  const claims = payload as ServiceTokenClaims
  if (claims.token_use !== 'service') {
    throw createError({ statusCode: 401, message: 'invalid_token: service token required' })
  }

  const scopes = stringValue(claims.scope).split(/\s+/).filter(Boolean)
  if (!scopes.includes(input.requiredScope)) {
    throw createError({ statusCode: 403, message: `insufficient_scope: ${input.requiredScope}` })
  }
  if (input.requireBoundTargetApp && stringValue(claims.target_app).toLowerCase() !== stringValue(input.audience).toLowerCase()) {
    throw createError({ statusCode: 401, message: 'invalid_token: target app claim mismatch' })
  }

  const hzyAppCode = normalizedAppCode(claims.hzy?.appCode)
  const sourceAppCode = normalizedAppCode(claims.source_app)
  if (hzyAppCode && sourceAppCode && hzyAppCode !== sourceAppCode) {
    throw createError({ statusCode: 401, message: 'invalid_token: source app claims mismatch' })
  }

  return {
    actorType: 'service',
    actorId: stringValue(claims.hzy?.clientCode || claims.client_id || claims.sub),
    // 只有两个由当前 issuer 同时签发的来源 claim 精确一致时，才形成可用于通知发布的应用身份。
    // 单个历史 JWT claim 不能作为 source_app 绑定事实。
    appCode: hzyAppCode && sourceAppCode ? hzyAppCode : null,
    tenantCode: stringValue(claims.tenant) || null,
    deploymentCode: stringValue(claims.deployment) || null
  }
}
