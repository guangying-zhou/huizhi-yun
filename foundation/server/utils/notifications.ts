import { createError, getHeader, type H3Event } from 'h3'
import { getConsoleRuntimeConfig, resolveConsoleRuntimeBaseUrl } from './consoleRuntime'
import { resolveServiceAppBaseUrl } from './serviceAppUrl'
import {
  fetchConsoleServiceJson,
  requestServiceAccessToken,
  trustedServiceRequestHeaders
} from './serviceOidc'
import { consoleServiceFetch } from './consoleServiceBinding'

export type IntegrationOperationDeadLetterSourceApp = 'aims' | 'altoc' | 'assets' | 'finance' | 'people'

type ConsoleApiResponse<T> = {
  code?: number
  data?: T
  message?: string
}

export interface PublishNotificationInput {
  sourceAppCode?: string
  eventType?: string
  category?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  title: string
  summary?: string
  body?: string
  actionUrl?: string
  bizType?: string
  bizId?: string | number
  idempotencyKey: string
  recipients: string[] | string
  channels?: string[]
  metadata?: Record<string, unknown>
  event?: H3Event | null
}

export interface AdvanceNotificationActionableLifecycleInput {
  sourceAppCode: string
  actionableKey: string
  expectedVersion: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
  recipients?: string[]
}

export interface IntegrationOperationDeadLetterNotificationInput {
  tenantCode: string
  deploymentCode: string
  sourceApp: IntegrationOperationDeadLetterSourceApp
  targetApp: string
  operationId: string
  operationCode: string
  sourceBizType: string
  sourceBizCode: string
  attemptCount: number
  maxAttempts: number
  lastErrorCode: string | null
  lastErrorClass: string | null
  deadLetteredAt: string
  originalActorUid: string | null
  /** Source-frozen dead-letter generation. Required by the actionable API. */
  generation?: number
  /** Source operation version observed when this generation was frozen. */
  operationVersion?: number
  /** Source-frozen identity. Foundation must not derive or rewrite it. */
  actionableKey?: string
  /** Source-frozen projection version. Foundation must not derive or rewrite it. */
  objectVersion?: string
}

export interface IntegrationOperationDeadLetterClosureInput {
  tenantCode: string
  deploymentCode: string
  sourceApp: IntegrationOperationDeadLetterSourceApp
  operationId: string
  generation: number
  actionableKey: string
  expectedVersion: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
}

export type IntegrationOperationDeadLetterConsoleInput
  = | IntegrationOperationDeadLetterNotificationInput
    | IntegrationOperationDeadLetterClosureInput

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }
    const normalized = stringValue(current)
    if (normalized) return normalized
  }
  return ''
}

async function resolveConsoleNotificationsBaseUrl(event?: H3Event | null) {
  const runtime = event
    ? await getConsoleRuntimeConfig({ event }).catch(() => null)
    : await getConsoleRuntimeConfig().catch(() => null)
  const config = useRuntimeConfig(event || undefined) as unknown as Record<string, unknown>
  return normalizeBaseUrl(runtime?.console.baseUrl || getConfigValue(config, [
    'hzy.runtime.consoleApiUrl',
    'hzy.directory.consoleApiUrl',
    'hzy.integration.consoleApiUrl',
    'hzy.consoleApiUrl',
    'public.consoleUrl'
  ]) || process.env.HZY_CONSOLE_API_URL || process.env.HZY_CONSOLE_URL || resolveConsoleRuntimeBaseUrl(config) || '')
}

function responseStatusCode(error: unknown) {
  const candidate = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  }
  return Number(candidate?.statusCode || candidate?.status || candidate?.response?.statusCode || candidate?.response?.status || 500)
}

function responseMessage(error: unknown) {
  const candidate = error as {
    message?: string
    statusMessage?: string
    data?: { message?: string, statusMessage?: string, error?: string }
  }
  return stringValue(candidate?.data?.message || candidate?.data?.statusMessage || candidate?.data?.error || candidate?.statusMessage || candidate?.message)
}

function firstHeaderValue(event: H3Event, name: string) {
  return stringValue(getHeader(event, name)).split(',')[0]?.trim() || ''
}

function safeHeaderHost(value: string) {
  const normalized = value.trim()
  return /^[a-z0-9.-]+(?::\d+)?$/i.test(normalized) ? normalized : ''
}

function safeHeaderProto(value: string) {
  const normalized = value.trim().toLowerCase().replace(/:$/, '')
  return normalized === 'http' || normalized === 'https' ? normalized : ''
}

function safeUrlHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return ''
  }
}

function sameOrigin(left: string, right: string) {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

function tenantGatewayOrigin(event: H3Event) {
  if (stringValue(getHeader(event, 'x-hzy-gateway')) !== 'tenant-gateway') {
    return ''
  }

  const host = safeHeaderHost(firstHeaderValue(event, 'x-hzy-forwarded-host') || firstHeaderValue(event, 'x-forwarded-host'))
  if (!host) return ''

  const proto = safeHeaderProto(firstHeaderValue(event, 'x-hzy-forwarded-proto') || firstHeaderValue(event, 'x-forwarded-proto')) || 'https'
  return `${proto}://${host}`
}

async function resolveConsoleNotificationsServerBaseUrl(event: H3Event) {
  const configuredBaseUrl = await resolveConsoleNotificationsBaseUrl(event)
  const gatewayBaseUrl = tenantGatewayOrigin(event)
  if (configuredBaseUrl && (!gatewayBaseUrl || !sameOrigin(configuredBaseUrl, gatewayBaseUrl))) {
    return configuredBaseUrl
  }

  return normalizeBaseUrl(resolveServiceAppBaseUrl(event, 'console', { basePath: '/' }))
    || configuredBaseUrl
    || gatewayBaseUrl
}

function tenantContextHeaders(event: H3Event) {
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-app-code',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-code',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }
  const host = firstHeaderValue(event, 'x-hzy-forwarded-host') || firstHeaderValue(event, 'x-forwarded-host')
  const proto = firstHeaderValue(event, 'x-hzy-forwarded-proto') || firstHeaderValue(event, 'x-forwarded-proto')
  if (host) headers['x-hzy-forwarded-host'] = host
  if (proto) headers['x-hzy-forwarded-proto'] = proto
  return headers
}

function notificationUserForwardHeaders(event: H3Event) {
  const auth = event.context.consoleAuth as {
    authenticated?: boolean
    token?: string | null
    tokenUse?: string | null
    subjectType?: string | null
  } | undefined
  const headers = tenantContextHeaders(event)
  if (!auth?.authenticated || auth.subjectType !== 'user' || auth.tokenUse === 'service') {
    return { headers: null, usesCookie: false }
  }

  const token = auth.tokenUse === 'access' ? stringValue(auth.token) : ''
  if (token) {
    headers.Authorization = `Bearer ${token}`
    return { headers, usesCookie: false }
  }

  const cookie = stringValue(getHeader(event, 'cookie'))
  if (cookie) {
    headers.cookie = cookie
    return { headers, usesCookie: true }
  }

  return { headers: null, usesCookie: false }
}

export function requireConsoleNotificationsUserCredentials(event: H3Event) {
  const forward = notificationUserForwardHeaders(event)
  if (!forward.headers) {
    throw createError({ statusCode: 401, message: 'Console user credentials are required' })
  }
}

async function unwrapConsoleResponse<T>(response: ConsoleApiResponse<T>) {
  if (response.code !== undefined && response.code !== 0) {
    throw createError({
      statusCode: 502,
      message: response.message || 'Console notifications API returned an error'
    })
  }
  return response.data as T
}

export async function fetchConsoleNotificationsForUser<T>(
  event: H3Event,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    query?: Record<string, unknown>
    body?: Record<string, unknown> | null
  } = {}
) {
  const forward = notificationUserForwardHeaders(event)
  if (!forward.headers) {
    throw createError({ statusCode: 401, message: 'Console user credentials are required' })
  }

  const baseUrl = await resolveConsoleNotificationsServerBaseUrl(event)
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console notifications API URL is not configured' })
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if ((options.method || 'GET') === 'POST') {
    forward.headers['idempotency-key'] = stringValue(getHeader(event, 'idempotency-key'))
      || `foundation:notification:${globalThis.crypto.randomUUID()}`
  }
  try {
    const response = await consoleServiceFetch<ConsoleApiResponse<T>>(event, `${baseUrl}${normalizedPath}`, {
      method: options.method || 'GET',
      headers: forward.headers,
      params: options.query,
      body: options.body,
      timeout: 10000
    })
    return await unwrapConsoleResponse(response)
  } catch (error) {
    console.warn('[notifications] Console notifications proxy failed:', {
      statusCode: responseStatusCode(error),
      message: responseMessage(error) || undefined,
      baseHost: safeUrlHost(baseUrl),
      path: normalizedPath,
      usesCookie: forward.usesCookie,
      hasGateway: stringValue(getHeader(event, 'x-hzy-gateway')) === 'tenant-gateway',
      avoidedGatewayOrigin: Boolean(tenantGatewayOrigin(event) && !sameOrigin(baseUrl, tenantGatewayOrigin(event))),
      forwardedHost: firstHeaderValue(event, 'x-hzy-forwarded-host') || firstHeaderValue(event, 'x-forwarded-host') || undefined,
      forwardedProto: firstHeaderValue(event, 'x-hzy-forwarded-proto') || firstHeaderValue(event, 'x-forwarded-proto') || undefined
    })
    throw error
  }
}

export async function publishNotification(input: PublishNotificationInput) {
  const event = input.event || null
  const baseUrl = await resolveConsoleNotificationsBaseUrl(event)
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console notifications API URL is not configured' })
  }

  const requestWithToken = async (forceRefresh: boolean) => {
    const token = await requestServiceAccessToken({
      audience: 'notifications',
      scope: 'notifications:publish',
      event,
      forceRefresh
    })
    return await fetchConsoleServiceJson<ConsoleApiResponse<{
      notificationId: string
      sourceAppCode: string
      recipients: string[]
      channels: string[]
    }>>(event, `${baseUrl}/api/v1/console/notifications/publish`, {
      method: 'POST',
      headers: {
        ...trustedServiceRequestHeaders(event),
        Authorization: `Bearer ${token}`
      },
      body: {
        sourceAppCode: input.sourceAppCode,
        eventType: input.eventType,
        category: input.category,
        severity: input.severity,
        title: input.title,
        summary: input.summary,
        body: input.body,
        actionUrl: input.actionUrl,
        bizType: input.bizType,
        bizId: input.bizId == null ? undefined : String(input.bizId),
        idempotencyKey: input.idempotencyKey,
        recipients: input.recipients,
        channels: input.channels || ['in_app'],
        metadata: input.metadata
      },
      timeout: 10000
    })
  }

  try {
    return await unwrapConsoleResponse(await requestWithToken(false))
  } catch (error) {
    if (responseStatusCode(error) !== 401) throw error
    return await unwrapConsoleResponse(await requestWithToken(true))
  }
}

export async function advanceNotificationActionableLifecycle(
  input: AdvanceNotificationActionableLifecycleInput,
  event?: H3Event | null
) {
  const requestEvent = event || null
  const baseUrl = await resolveConsoleNotificationsBaseUrl(requestEvent)
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console notifications API URL is not configured' })
  }

  const requestWithToken = async (forceRefresh: boolean) => {
    const token = await requestServiceAccessToken({
      audience: 'notifications',
      scope: 'notifications:publish',
      event: requestEvent,
      forceRefresh
    })
    return await fetchConsoleServiceJson<ConsoleApiResponse<{
      sourceAppCode: string
      actionableKey: string
      state: 'resolved' | 'cancelled'
      objectVersion: string
      matched: number
      updated: number
      replayed: number
    }>>(requestEvent, `${baseUrl}/api/v1/console/notifications/actionable-lifecycle`, {
      method: 'POST',
      headers: {
        ...trustedServiceRequestHeaders(requestEvent),
        Authorization: `Bearer ${token}`
      },
      body: input,
      timeout: 10000
    })
  }

  try {
    return await unwrapConsoleResponse(await requestWithToken(false))
  } catch (error) {
    if (responseStatusCode(error) !== 401) throw error
    return await unwrapConsoleResponse(await requestWithToken(true))
  }
}

export async function publishIntegrationOperationDeadLetter(
  input: IntegrationOperationDeadLetterConsoleInput,
  event?: H3Event | null
) {
  const baseUrl = await resolveConsoleNotificationsBaseUrl(event)
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console notifications API URL is not configured' })
  }

  const isClosure = 'state' in input
  // Legacy source scans can contain internal fields. Keep this wire contract
  // explicit so those values never cross into Console notification handling.
  const notificationBody = isClosure
    ? null
    : {
        tenantCode: input.tenantCode,
        deploymentCode: input.deploymentCode,
        sourceApp: input.sourceApp,
        targetApp: input.targetApp,
        operationId: input.operationId,
        operationCode: input.operationCode,
        sourceBizType: input.sourceBizType,
        sourceBizCode: input.sourceBizCode,
        attemptCount: input.attemptCount,
        maxAttempts: input.maxAttempts,
        lastErrorCode: input.lastErrorCode,
        lastErrorClass: input.lastErrorClass,
        deadLetteredAt: input.deadLetteredAt,
        originalActorUid: input.originalActorUid,
        generation: input.generation,
        operationVersion: input.operationVersion,
        actionableKey: input.actionableKey,
        objectVersion: input.objectVersion
      }
  const requestWithToken = async (forceRefresh: boolean) => {
    const token = await requestServiceAccessToken({
      audience: 'notifications',
      scope: 'notifications:publish',
      event,
      forceRefresh
    })
    return await fetchConsoleServiceJson<ConsoleApiResponse<{
      notificationId?: string
      sourceAppCode: string
      recipients?: string[]
      recipientSource?: 'operator' | 'configured_fallback'
      channels?: string[]
      state?: 'resolved' | 'cancelled'
      objectVersion?: string
    }>>(event, `${baseUrl}${isClosure
      ? '/api/v1/console/notifications/actionable-lifecycle'
      : '/api/v1/console/notifications/integration-operation-dead-letter'}`, {
      method: 'POST',
      headers: {
        ...trustedServiceRequestHeaders(event),
        Authorization: `Bearer ${token}`
      },
      body: isClosure
        ? {
            sourceAppCode: input.sourceApp,
            actionableKey: input.actionableKey,
            expectedVersion: input.expectedVersion,
            nextVersion: input.nextVersion,
            state: input.state
          }
        : notificationBody,
      timeout: 10000
    })
  }

  try {
    return await unwrapConsoleResponse(await requestWithToken(false))
  } catch (error) {
    if (responseStatusCode(error) !== 401) throw error
    return await unwrapConsoleResponse(await requestWithToken(true))
  }
}
