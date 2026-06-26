import { createError, getHeader, getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import { $fetch as fetchExternal } from 'ofetch'
import { requestServiceAccessToken } from './serviceOidc'
import { resolveDeploymentProfile } from './deploymentProfile'

export type DataRuntimeMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export type DataRuntimeCallOptions = {
  appCode: string
  scope: string
  method?: string
  query?: Record<string, unknown>
  body?: unknown
}

export type DataRuntimeSkipped = {
  handled: false
}

export type DataRuntimeHandled<T> = {
  handled: true
  data: T
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

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function configValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }
    const value = stringValue(current)
    if (value) return value
  }
  return ''
}

function cloudflareEnv(event: H3Event): CloudflareEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || {}
}

function cloudflareEnvValue(event: H3Event, names: string[]) {
  const env = cloudflareEnv(event)
  for (const name of names) {
    const value = stringValue(env[name])
    if (value) return value
  }
  return ''
}

function processEnvValue(names: string[]) {
  for (const name of names) {
    const value = stringValue(process.env[name])
    if (value) return value
  }
  return ''
}

function appEnvName(appCode: string, suffix: string) {
  return `HZY_${appCode.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_${suffix}`
}

function constantTimeEquals(left: string, right: string) {
  if (!left || !right) return false
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0)
  }
  return diff === 0
}

function tenantGatewayInternalToken(event: H3Event, config: Record<string, unknown>) {
  return configValue(config, [
    'hzy.cloudflareInternalToken',
    'hzy.tenantGateway.internalToken',
    'tenantGateway.internalToken',
    'security.cloudflareInternalToken',
    'security.tenantGatewayInternalToken'
  ]) || cloudflareEnvValue(event, [
    'HZY_CLOUDFLARE_INTERNAL_TOKEN',
    'HZY_TENANT_GATEWAY_INTERNAL_TOKEN',
    'HZY_CONSOLE_TENANT_GATEWAY_TOKEN',
    'TENANT_GATEWAY_INTERNAL_TOKEN'
  ]) || processEnvValue([
    'HZY_CLOUDFLARE_INTERNAL_TOKEN',
    'HZY_TENANT_GATEWAY_INTERNAL_TOKEN',
    'HZY_CONSOLE_TENANT_GATEWAY_TOKEN',
    'TENANT_GATEWAY_INTERNAL_TOKEN'
  ])
}

function isTrustedTenantGatewayRequest(event: H3Event, config: Record<string, unknown>) {
  if (stringValue(getHeader(event, 'x-hzy-gateway')) !== 'tenant-gateway') return false
  const expectedToken = tenantGatewayInternalToken(event, config)
  if (!expectedToken) return false
  return constantTimeEquals(stringValue(getHeader(event, 'x-hzy-gateway-token')), expectedToken)
}

function tenantGatewayHeader(event: H3Event, config: Record<string, unknown>, name: string) {
  return isTrustedTenantGatewayRequest(event, config) ? stringValue(getHeader(event, name)) : ''
}

function dataRuntimeEndpoint(event: H3Event, appCode: string, config: Record<string, unknown>) {
  return tenantGatewayHeader(event, config, 'x-hzy-data-runtime-url') || configValue(config, [
    'hzy.dataRuntime.endpoint',
    'dataRuntime.endpoint'
  ]) || cloudflareEnvValue(event, [appEnvName(appCode, 'DATA_RUNTIME_URL'), 'HZY_DATA_RUNTIME_URL']) || processEnvValue([appEnvName(appCode, 'DATA_RUNTIME_URL'), 'HZY_DATA_RUNTIME_URL'])
}

function dataRuntimeToken(event: H3Event, appCode: string, config: Record<string, unknown>) {
  return tenantGatewayHeader(event, config, 'x-hzy-data-runtime-token') || configValue(config, [
    'hzy.dataRuntime.token',
    'dataRuntime.token'
  ]) || cloudflareEnvValue(event, [appEnvName(appCode, 'DATA_RUNTIME_TOKEN'), 'HZY_DATA_RUNTIME_TOKEN']) || processEnvValue([appEnvName(appCode, 'DATA_RUNTIME_TOKEN'), 'HZY_DATA_RUNTIME_TOKEN'])
}

function dataRuntimeAudience(event: H3Event, config: Record<string, unknown>) {
  return tenantGatewayHeader(event, config, 'x-hzy-data-runtime-audience') || configValue(config, [
    'hzy.dataRuntime.audience',
    'dataRuntime.audience'
  ]) || cloudflareEnvValue(event, ['HZY_DATA_RUNTIME_AUDIENCE']) || process.env.HZY_DATA_RUNTIME_AUDIENCE || 'data-runtime'
}

function optionalHeader(event: H3Event, config: Record<string, unknown>, keys: string[], fallbackEnv: string, gatewayHeaderName?: string) {
  const gatewayValue = gatewayHeaderName ? tenantGatewayHeader(event, config, gatewayHeaderName) : ''
  if (gatewayValue) return gatewayValue
  return configValue(config, keys) || cloudflareEnvValue(event, [fallbackEnv]) || process.env[fallbackEnv] || ''
}

function appendQuery(url: URL, query: Record<string, unknown>) {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) url.searchParams.append(key, String(item))
      }
      continue
    }
    url.searchParams.set(key, String(value))
  }
}

function normalizeMethod(value: unknown): DataRuntimeMethod {
  const method = String(value || 'GET').toUpperCase()
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') return method
  return 'GET'
}

async function resolveBearerToken(event: H3Event, options: DataRuntimeCallOptions, config: Record<string, unknown>) {
  const staticToken = dataRuntimeToken(event, options.appCode, config)
  if (staticToken) return staticToken
  return await requestServiceAccessToken({
    audience: dataRuntimeAudience(event, config),
    scope: options.scope,
    event
  })
}

export function isDataRuntimeEnabled(event: H3Event, appCode: string, config = useRuntimeConfig() as unknown as Record<string, unknown>) {
  return resolveDeploymentProfile(config) === 'managed-cloud-agent' && Boolean(dataRuntimeEndpoint(event, appCode, config))
}

export async function maybeCallDataRuntime<T>(
  event: H3Event,
  path: string,
  options: DataRuntimeCallOptions
): Promise<DataRuntimeSkipped | DataRuntimeHandled<T>> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const endpoint = dataRuntimeEndpoint(event, options.appCode, config)
  if (resolveDeploymentProfile(config) !== 'managed-cloud-agent' || !endpoint) {
    return { handled: false }
  }

  const url = new URL(path, endpoint.endsWith('/') ? endpoint : `${endpoint}/`)
  appendQuery(url, options.query || getQuery(event))
  const method = normalizeMethod(options.method)
  const token = await resolveBearerToken(event, options, config)
  const requestId = stringValue(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  const tenant = optionalHeader(event, config, ['hzy.dataRuntime.tenant', 'dataRuntime.tenant'], 'HZY_DATA_RUNTIME_TENANT', 'x-hzy-tenant')
  const deployment = optionalHeader(event, config, ['hzy.dataRuntime.deployment', 'dataRuntime.deployment'], 'HZY_DATA_RUNTIME_DEPLOYMENT', 'x-hzy-deployment')

  try {
    const data = await fetchExternal<T>(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
        ...(requestId ? { 'x-request-id': requestId } : {}),
        ...(tenant ? { 'x-hzy-tenant': tenant } : {}),
        ...(deployment ? { 'x-hzy-deployment': deployment } : {})
      },
      ...(method === 'GET' ? {} : { body: options.body ?? {} }),
      timeout: 10000
    })
    return { handled: true, data }
  } catch (error: unknown) {
    const fetchError = error as {
      status?: number
      statusCode?: number
      statusMessage?: string
      data?: {
        error?: {
          message?: string
        }
      }
    }
    const upstreamStatus = Number(fetchError.statusCode || fetchError.status || 0)
    const statusCode = upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502
    const message = fetchError.data?.error?.message || (error instanceof Error ? error.message : String(error))
    throw createError({
      statusCode,
      statusMessage: statusCode === 502 ? 'Data Runtime Agent request failed' : fetchError.statusMessage,
      message
    })
  }
}

export async function maybeCallCurrentAppDataRuntime<T>(
  event: H3Event,
  options: {
    appCode: string
    scope: string
    pathPrefix?: string
  }
): Promise<DataRuntimeSkipped | DataRuntimeHandled<T>> {
  const pathname = getRequestURL(event).pathname
  const marker = options.pathPrefix || '/api/v1'
  const markerIndex = pathname.indexOf(marker)
  if (markerIndex < 0) return { handled: false }

  const suffix = pathname.slice(markerIndex + marker.length)
  const path = `/v1/${options.appCode}${suffix}`
  const method = normalizeMethod(event.node.req.method)
  const body = method === 'GET' ? undefined : await readBody(event)
  return maybeCallDataRuntime<T>(event, path, {
    appCode: options.appCode,
    scope: options.scope,
    method,
    body
  })
}
