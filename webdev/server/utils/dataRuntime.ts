import { createError, getHeader, type H3Event } from 'h3'
import {
  isPlatformRuntimeBootstrapToken,
  isTenantRuntimeEnabled,
  maybeCallTenantRuntime
} from '@hzy/foundation/server/utils/tenantRuntimeClient'

type FetchOptions = {
  method?: string
  body?: unknown
  query?: Record<string, string | number | undefined>
}

type FetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type UpstreamFetchError = {
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: unknown
}

type JobSnapshot = {
  id?: string
  projectId?: string
  type?: string
  status?: string
  repoId?: string
  agentId?: string
  templateId?: string
  target?: string
  prompt?: string
  createdBy?: string
  createdAt?: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  error?: string
}

type JobEventSnapshot = {
  sequence?: number
  level?: string
  message?: string
  createdAt?: string
}

function cleanBaseUrl(input: unknown) {
  return String(input || '').trim().replace(/\/+$/, '')
}

type CloudflareEnv = Record<string, unknown>

type CloudflareRuntimeEvent = H3Event & {
  context?: H3Event['context'] & {
    cloudflare?: {
      env?: CloudflareEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
}

function cloudflareEnv(event?: H3Event): CloudflareEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent | undefined
  return runtimeEvent?.context?.cloudflare?.env
    || runtimeEvent?.context?._platform?.cloudflare?.env
    || runtimeEvent?.req?.runtime?.cloudflare?.env
    || {}
}

function envValue(event: H3Event | undefined, names: string[]) {
  const env = cloudflareEnv(event)
  for (const name of names) {
    const value = String(env[name] || process.env[name] || '').trim()
    if (value) return value
  }
  return ''
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function tenantGatewayToken(event: H3Event | undefined) {
  return envValue(event, ['HZY_TENANT_GATEWAY_TOKEN'])
}

function tenantDomainSuffix(event: H3Event | undefined) {
  return envValue(event, ['HZY_TENANT_DOMAIN_SUFFIX']) || 'huizhi.yun'
}

function isAuthenticatedServiceRequest(event: H3Event | undefined) {
  const auth = event?.context.consoleAuth as {
    authenticated?: boolean
    tokenUse?: string
    subjectType?: string
  } | undefined
  return Boolean(auth?.authenticated && auth.tokenUse === 'service' && auth.subjectType === 'service')
}

function isAuthenticatedUserRequest(event: H3Event | undefined) {
  const auth = event?.context.consoleAuth as {
    authenticated?: boolean
    subjectType?: string
  } | undefined
  return Boolean(auth?.authenticated && auth.subjectType !== 'service')
}

function isCloudflareWorkerSubrequest(event: H3Event | undefined) {
  return Boolean(event && stringValue(getHeader(event, 'cf-worker')))
}

function isAllowedForwardedDataRuntimeUrl(event: H3Event | undefined) {
  const value = stringValue(event ? getHeader(event, 'x-hzy-data-runtime-url') : '')
  if (!value) return false

  try {
    const url = new URL(value)
    const suffix = tenantDomainSuffix(event).replace(/^\.+|\.+$/g, '').toLowerCase()
    const hostname = url.hostname.toLowerCase()
    return url.protocol === 'https:'
      && Boolean(suffix)
      && hostname.endsWith(`.${suffix}`)
      && (hostname === `data-runtime.${suffix}` || hostname.endsWith(`-data-runtime.${suffix}`))
  } catch {
    return false
  }
}

function hasTenantGatewayRuntimeHeaders(event: H3Event | undefined) {
  return Boolean(
    event
    && stringValue(getHeader(event, 'x-hzy-gateway-token'))
    && stringValue(getHeader(event, 'x-hzy-tenant'))
    && stringValue(getHeader(event, 'x-hzy-deployment'))
    && stringValue(getHeader(event, 'x-hzy-data-runtime-token'))
    && isAllowedForwardedDataRuntimeUrl(event)
  )
}

function isTrustedTenantGatewayRequest(event: H3Event | undefined) {
  if (!event) return false
  if (stringValue(getHeader(event, 'x-hzy-gateway')) !== 'tenant-gateway') return false

  const expectedToken = tenantGatewayToken(event)
  if (!expectedToken) {
    return isAuthenticatedServiceRequest(event)
      || (isAuthenticatedUserRequest(event) && isCloudflareWorkerSubrequest(event) && hasTenantGatewayRuntimeHeaders(event))
  }

  return stringValue(getHeader(event, 'x-hzy-gateway-token')) === expectedToken
}

function tenantGatewayHeader(event: H3Event | undefined, name: string) {
  return isTrustedTenantGatewayRequest(event) ? stringValue(getHeader(event!, name)) : ''
}

function forwardedDataRuntimeToken(event: H3Event | undefined) {
  const token = tenantGatewayHeader(event, 'x-hzy-data-runtime-token')
  // The Platform bootstrap credential must remain on the Console -> WebDev
  // request so WebDev can introspect the Console service token. It is not a
  // WebDev Data Runtime bearer, however, so fall back to WebDev's configured
  // compatibility credential for the subsequent runtime call.
  return isPlatformRuntimeBootstrapToken(token) ? '' : token
}

function normalizeMethod(value: unknown): FetchMethod | undefined {
  const method = stringValue(value).toUpperCase()
  if (method === 'GET' || method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return method
  }
  return undefined
}

function currentUserActor(event: H3Event) {
  const auth = event.context.consoleAuth as {
    authenticated?: boolean
    subjectType?: string
    uid?: string
  } | undefined
  const uid = stringValue(auth?.uid)
  return auth?.authenticated && auth?.subjectType !== 'service' && uid ? uid : ''
}

function appendQuery(url: URL, query: FetchOptions['query']) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function actorDelegationHeaders(event: H3Event, token: string, method: FetchMethod, requestTarget: string): Promise<Record<string, string>> {
  const actorUid = currentUserActor(event)
  if (!actorUid) return {}

  const signedAt = String(Date.now())
  const payload = [method, requestTarget, actorUid, '', signedAt].join('\n')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
  return {
    'x-hzy-actor-uid': actorUid,
    'x-hzy-actor-signed-at': signedAt,
    'x-hzy-actor-signature': base64Url(signature)
  }
}

function dataRuntimeConfig(event?: H3Event) {
  const config = useRuntimeConfig()
  return {
    baseUrl: cleanBaseUrl(tenantGatewayHeader(event, 'x-hzy-data-runtime-url') || config.dataRuntime?.baseUrl || envValue(event, ['HZY_WEBDEV_DATA_RUNTIME_URL', 'HZY_DATA_RUNTIME_URL'])),
    token: String(forwardedDataRuntimeToken(event) || config.dataRuntime?.token || envValue(event, ['HZY_WEBDEV_DATA_RUNTIME_TOKEN', 'HZY_DATA_RUNTIME_TOKEN']) || '').trim(),
    tenant: tenantGatewayHeader(event, 'x-hzy-tenant') || envValue(event, ['HZY_DATA_RUNTIME_TENANT']),
    deployment: tenantGatewayHeader(event, 'x-hzy-deployment') || envValue(event, ['HZY_DATA_RUNTIME_DEPLOYMENT'])
  }
}

export function isDataRuntimeConfigured(event?: H3Event): boolean {
  const config = dataRuntimeConfig(event)
  return Boolean(
    (event && isTenantRuntimeEnabled(event, 'webdev'))
    || (config.baseUrl && config.token)
  )
}

export async function dataRuntimeFetch<T = unknown>(event: H3Event, path: string, options: FetchOptions = {}): Promise<T> {
  const method = normalizeMethod(options.method) || 'GET'
  const runtime = await maybeCallTenantRuntime<T>(event, path, {
    appCode: 'webdev',
    scope: method === 'GET' ? 'webdev.read' : 'webdev.write',
    method,
    body: options.body,
    query: options.query || {},
    serviceTokenSourceBinding: 'service-client-policy'
  })
  if (runtime.handled) return runtime.data

  // Explicit local/PoC deployments may still use the legacy static bearer.
  // Managed tenant-runtime profiles always use the short-lived Console token
  // path above and never fall back after an authenticated runtime rejection.
  const config = dataRuntimeConfig(event)
  if (!config.baseUrl || !config.token) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Data Runtime endpoint is not configured'
    })
  }

  try {
    const url = new URL(`${config.baseUrl}${path}`)
    appendQuery(url, options.query)
    const actorHeaders = await actorDelegationHeaders(event, config.token, method, `${url.pathname}${url.search}`)
    const response = await $fetch<unknown>(url.toString(), {
      method,
      body: options.body as Record<string, unknown> | undefined,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...actorHeaders,
        ...(config.tenant ? { 'x-hzy-tenant': config.tenant } : {}),
        ...(config.deployment ? { 'x-hzy-deployment': config.deployment } : {})
      }
    })
    return response as T
  } catch (error: unknown) {
    const fetchError = error as UpstreamFetchError
    console.warn('[webdev] data runtime request failed:', {
      statusCode: fetchError.statusCode,
      statusMessage: fetchError.statusMessage || fetchError.message,
      path,
      hasBaseUrl: Boolean(config.baseUrl),
      hasToken: Boolean(config.token),
      tenant: config.tenant || undefined,
      deployment: config.deployment || undefined,
      trustedTenantGateway: isTrustedTenantGatewayRequest(event)
    })
    throw createError({
      statusCode: fetchError.statusCode || 502,
      statusMessage: fetchError.statusMessage || fetchError.message || 'Data Runtime request failed',
      data: fetchError.data
    })
  }
}

export async function persistJobSnapshot(event: H3Event, input: unknown): Promise<void> {
  const job = input as JobSnapshot
  if (!isDataRuntimeConfigured(event) || !job?.id || !job.type) {
    return
  }

  await bestEffort(async () => {
    await dataRuntimeFetch(event, isAuthenticatedServiceRequest(event) ? '/v1/webdev/service/jobs' : '/v1/webdev/jobs', {
      method: 'POST',
      body: {
        id: job.id,
        projectId: job.projectId,
        type: job.type,
        status: job.status,
        repoId: job.repoId,
        agentId: job.agentId,
        templateId: job.templateId,
        target: job.target,
        prompt: job.prompt,
        createdBy: job.createdBy,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        exitCode: job.exitCode,
        error: job.error
      }
    })
  })
}

export async function persistJobEvents(event: H3Event, jobId: string, events: unknown[]): Promise<void> {
  if (!isDataRuntimeConfigured(event) || !jobId || !events.length) {
    return
  }

  await bestEffort(async () => {
    for (const item of events as JobEventSnapshot[]) {
      await dataRuntimeFetch(event, `/v1/webdev/jobs/${encodeURIComponent(jobId)}/events`, {
        method: 'POST',
        body: item
      })
    }
  })
}

async function bestEffort(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    console.warn('[webdev] metadata persistence skipped', error)
  }
}
