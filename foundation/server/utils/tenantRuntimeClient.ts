import { createError, getHeader, getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import { $fetch as fetchExternal } from 'ofetch'
import { requestServiceAccessToken } from './serviceOidc'
import { resolveDeploymentProfile } from './deploymentProfile'
import { tenantRuntimeErrorData, type TenantRuntimeErrorEnvelope } from './tenantRuntimeErrors'

export type TenantRuntimeMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export type TenantRuntimeCallOptions = {
  appCode: string
  scope: string
  method?: string
  query?: Record<string, unknown>
  body?: unknown
}

export type TenantRuntimeSkipped = {
  handled: false
}

export type TenantRuntimeHandled<T> = {
  handled: true
  data: T
}

export type TenantRuntimeResolutionOptions = {
  includeGlobal?: boolean
}

export interface TenantRuntimePageEnvelope<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  summary?: Record<string, unknown>
}

type TenantRuntimeActorAuth = {
  authenticated?: boolean
  uid?: string | null
  subjectType?: string | null
  deptCode?: string | null
  deptCodes?: string[] | string | null
  claims?: Record<string, unknown> | null
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

function tenantGatewayHeader(event: H3Event, names: string[], config: Record<string, unknown>) {
  if (!isTrustedTenantGatewayRequest(event, config)) return ''
  for (const name of names) {
    const value = stringValue(getHeader(event, name))
    if (value) return value
  }
  return ''
}

function tenantRuntimeEndpoint(
  event: H3Event,
  appCode: string,
  config: Record<string, unknown>,
  options: TenantRuntimeResolutionOptions = {}
) {
  const includeGlobal = options.includeGlobal !== false
  const tenantRuntimeEnvNames = [
    appEnvName(appCode, 'TENANT_RUNTIME_URL'),
    ...(includeGlobal ? ['HZY_TENANT_RUNTIME_URL'] : []),
    appEnvName(appCode, 'DATA_RUNTIME_URL'),
    ...(includeGlobal ? ['HZY_DATA_RUNTIME_URL'] : [])
  ]

  return tenantGatewayHeader(event, ['x-hzy-tenant-runtime-url', 'x-hzy-data-runtime-url'], config) || configValue(config, [
    'hzy.tenantRuntime.endpoint',
    'tenantRuntime.endpoint',
    'hzy.dataRuntime.endpoint',
    'dataRuntime.endpoint'
  ]) || cloudflareEnvValue(event, tenantRuntimeEnvNames) || processEnvValue(tenantRuntimeEnvNames)
}

function tenantRuntimeToken(event: H3Event, appCode: string, config: Record<string, unknown>) {
  return tenantGatewayHeader(event, ['x-hzy-tenant-runtime-token', 'x-hzy-data-runtime-token'], config) || configValue(config, [
    'hzy.tenantRuntime.token',
    'tenantRuntime.token',
    'hzy.dataRuntime.token',
    'dataRuntime.token'
  ]) || cloudflareEnvValue(event, [
    appEnvName(appCode, 'TENANT_RUNTIME_TOKEN'),
    'HZY_TENANT_RUNTIME_TOKEN',
    appEnvName(appCode, 'DATA_RUNTIME_TOKEN'),
    'HZY_DATA_RUNTIME_TOKEN'
  ]) || processEnvValue([
    appEnvName(appCode, 'TENANT_RUNTIME_TOKEN'),
    'HZY_TENANT_RUNTIME_TOKEN',
    appEnvName(appCode, 'DATA_RUNTIME_TOKEN'),
    'HZY_DATA_RUNTIME_TOKEN'
  ])
}

function tenantRuntimeAudience(event: H3Event, config: Record<string, unknown>) {
  return tenantGatewayHeader(event, ['x-hzy-data-runtime-audience', 'x-hzy-tenant-runtime-audience'], config) || cloudflareEnvValue(event, [
    'HZY_DATA_RUNTIME_AUDIENCE'
  ]) || processEnvValue([
    'HZY_DATA_RUNTIME_AUDIENCE'
  ]) || configValue(config, [
    'hzy.dataRuntime.audience',
    'dataRuntime.audience'
  ]) || configValue(config, [
    'hzy.tenantRuntime.audience',
    'tenantRuntime.audience'
  ]) || cloudflareEnvValue(event, [
    'HZY_TENANT_RUNTIME_AUDIENCE'
  ]) || processEnvValue([
    'HZY_TENANT_RUNTIME_AUDIENCE'
  ]) || 'data-runtime'
}

function optionalHeader(
  event: H3Event,
  config: Record<string, unknown>,
  keys: string[],
  envNames: string[],
  gatewayHeaderNames: string[]
) {
  const gatewayValue = tenantGatewayHeader(event, gatewayHeaderNames, config)
  if (gatewayValue) return gatewayValue
  return configValue(config, keys) || cloudflareEnvValue(event, envNames) || processEnvValue(envNames)
}

function dataAccessMode(config: Record<string, unknown>, appCode: string) {
  return (
    processEnvValue([appEnvName(appCode, 'DATA_ACCESS_MODE'), 'HZY_DATA_ACCESS_MODE'])
    || configValue(config, [
      'hzy.tenantRuntime.dataAccessMode',
      'tenantRuntime.dataAccessMode',
      'hzy.dataRuntime.dataAccessMode',
      'dataRuntime.dataAccessMode',
      'hzy.dataAccessMode',
      'dataAccessMode'
    ])
  ).toLowerCase()
}

function shouldCallTenantRuntime(config: Record<string, unknown>, appCode: string, endpoint: string) {
  const mode = dataAccessMode(config, appCode)
  if (mode === 'direct-db') return false
  if (mode === 'tenant-runtime' || mode === 'fallback') return Boolean(endpoint)
  return resolveDeploymentProfile(config) === 'managed-cloud-agent' && Boolean(endpoint)
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

function normalizeMethod(value: unknown): TenantRuntimeMethod {
  const method = String(value || 'GET').toUpperCase()
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') return method
  return 'GET'
}

function tenantRuntimeTokenScope(audience: string, scope: string): string {
  const normalizedAudience = stringValue(audience)
  const normalizedScope = stringValue(scope)
  if (!normalizedAudience || !normalizedScope) return normalizedScope
  const scopes = normalizedScope.split(/\s+/).filter(Boolean)
  if (scopes.length > 1) {
    return scopes.map(item => tenantRuntimeTokenScope(normalizedAudience, item)).join(' ')
  }
  if (normalizedScope.startsWith(`${normalizedAudience}:`)) return normalizedScope

  const [appCode, action] = normalizedScope.split(/\.(.+)/).filter(Boolean)
  if (!appCode || !action) return normalizedScope

  return `${normalizedAudience}:${appCode}:${action}`
}

async function resolveBearerToken(event: H3Event, options: TenantRuntimeCallOptions, config: Record<string, unknown>) {
  const staticToken = tenantRuntimeToken(event, options.appCode, config)
  if (staticToken) return staticToken
  const audience = tenantRuntimeAudience(event, config)
  return await requestServiceAccessToken({
    audience,
    scope: tenantRuntimeTokenScope(audience, options.scope),
    event
  })
}

function currentSubjectUid(event: H3Event) {
  return stringValue(verifiedUserConsoleAuth(event)?.uid)
}

function verifiedUserConsoleAuth(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as TenantRuntimeActorAuth | undefined
  if (!consoleAuth?.authenticated || consoleAuth.subjectType === 'service') return null
  return consoleAuth
}

function splitCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(item => splitCodes(item))
  return String(value || '')
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function uniqueCodes(values: string[]) {
  return Array.from(new Set(values))
}

function currentSubjectDeptCodes(event: H3Event) {
  const consoleAuth = verifiedUserConsoleAuth(event)
  const values: string[] = []
  if (consoleAuth) {
    values.push(...splitCodes(consoleAuth.deptCodes))
    values.push(...splitCodes(consoleAuth.deptCode))
    values.push(...splitCodes(consoleAuth.claims?.dept_codes))
    values.push(...splitCodes(consoleAuth.claims?.dept_code))
  }
  return uniqueCodes(values)
}

function base64Url(bytes: ArrayBuffer) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function signActorDelegation(input: {
  token: string
  method: TenantRuntimeMethod
  requestTarget: string
  actorUid: string
  deptCodes: string[]
  signedAt: string
}) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const payload = [
    input.method,
    input.requestTarget,
    input.actorUid,
    input.deptCodes.join(','),
    input.signedAt
  ].join('\n')
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return base64Url(signature)
}

export function isTenantRuntimeEndpointConfigured(
  event: H3Event,
  appCode: string,
  config = useRuntimeConfig() as unknown as Record<string, unknown>,
  options: TenantRuntimeResolutionOptions = {}
) {
  return Boolean(tenantRuntimeEndpoint(event, appCode, config, options))
}

export function isTenantRuntimeEnabled(
  event: H3Event,
  appCode: string,
  config = useRuntimeConfig() as unknown as Record<string, unknown>,
  options: TenantRuntimeResolutionOptions = {}
) {
  return shouldCallTenantRuntime(config, appCode, tenantRuntimeEndpoint(event, appCode, config, options))
}

export async function maybeCallTenantRuntime<T>(
  event: H3Event,
  path: string,
  options: TenantRuntimeCallOptions
): Promise<TenantRuntimeSkipped | TenantRuntimeHandled<T>> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const endpoint = tenantRuntimeEndpoint(event, options.appCode, config)
  if (!shouldCallTenantRuntime(config, options.appCode, endpoint)) {
    return { handled: false }
  }

  const url = new URL(path, endpoint.endsWith('/') ? endpoint : `${endpoint}/`)
  appendQuery(url, options.query || getQuery(event))
  const method = normalizeMethod(options.method)
  const token = await resolveBearerToken(event, options, config)
  const requestId = stringValue(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  const idempotencyKey = stringValue(getHeader(event, 'idempotency-key'))
  const subjectUid = currentSubjectUid(event)
  const subjectDeptCodes = currentSubjectDeptCodes(event)
  const actorSignedAt = subjectUid ? String(Date.now()) : ''
  const actorSignature = subjectUid
    ? await signActorDelegation({
        token,
        method,
        requestTarget: `${url.pathname}${url.search}`,
        actorUid: subjectUid,
        deptCodes: subjectDeptCodes,
        signedAt: actorSignedAt
      })
    : ''
  const tenant = optionalHeader(event, config, [
    'hzy.tenantRuntime.tenant',
    'tenantRuntime.tenant',
    'hzy.dataRuntime.tenant',
    'dataRuntime.tenant'
  ], [
    'HZY_TENANT_RUNTIME_TENANT',
    'HZY_DATA_RUNTIME_TENANT'
  ], ['x-hzy-tenant'])
  const deployment = optionalHeader(event, config, [
    'hzy.tenantRuntime.deployment',
    'tenantRuntime.deployment',
    'hzy.dataRuntime.deployment',
    'dataRuntime.deployment'
  ], [
    'HZY_TENANT_RUNTIME_DEPLOYMENT',
    'HZY_DATA_RUNTIME_DEPLOYMENT'
  ], ['x-hzy-deployment'])

  try {
    const data = await fetchExternal<T>(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
        ...(requestId ? { 'x-request-id': requestId } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        ...(subjectUid ? { 'x-hzy-actor-uid': subjectUid } : {}),
        ...(subjectDeptCodes[0] ? { 'x-hzy-actor-dept-code': subjectDeptCodes[0] } : {}),
        ...(subjectDeptCodes.length > 0 ? { 'x-hzy-actor-dept-codes': subjectDeptCodes.join(',') } : {}),
        ...(actorSignedAt ? { 'x-hzy-actor-signed-at': actorSignedAt } : {}),
        ...(actorSignature ? { 'x-hzy-actor-signature': actorSignature } : {}),
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
      data?: TenantRuntimeErrorEnvelope
    }
    const runtimeError = tenantRuntimeErrorData(
      fetchError,
      error instanceof Error ? error.message : String(error)
    )
    throw createError({
      statusCode: runtimeError.statusCode,
      statusMessage: runtimeError.statusCode === 502 ? 'Tenant Runtime request failed' : fetchError.statusMessage,
      message: runtimeError.message,
      data: {
        code: runtimeError.code,
        message: runtimeError.message,
        upstreamStatus: runtimeError.upstreamStatus
      }
    })
  }
}

export async function maybeCallCurrentAppTenantRuntime<T>(
  event: H3Event,
  options: {
    appCode: string
    scope: string
    pathPrefix?: string
  }
): Promise<TenantRuntimeSkipped | TenantRuntimeHandled<T>> {
  const pathname = getRequestURL(event).pathname
  const marker = options.pathPrefix || '/api/v1'
  const markerIndex = pathname.indexOf(marker)
  if (markerIndex < 0) return { handled: false }

  const suffix = pathname.slice(markerIndex + marker.length)
  const path = `/v1/${options.appCode}${suffix}`
  const method = normalizeMethod(event.node.req.method)
  const body = method === 'GET' ? undefined : await readBody(event)
  return maybeCallTenantRuntime<T>(event, path, {
    appCode: options.appCode,
    scope: options.scope,
    method,
    body
  })
}
