import { createError, getHeader, type H3Event } from 'h3'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { isPlatformRuntimeBootstrapToken } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  normalizeDataRuntimeHealth,
  type NormalizedDataRuntimeHealth
} from '~~/server/utils/dataRuntimeHealth'
import { isTrustedTenantGatewayRequest } from '~~/server/utils/platformRuntime'
import { getSystemParameters } from '~~/server/utils/systemParameters'

const DEFAULT_PACKAGE_BASE_URL = 'https://downloads.huizhi.yun/packages/hzy-data-runtime'
const DEFAULT_AUDIENCE = 'data-runtime'
const FALLBACK_AUDIENCES = ['data-runtime', 'tenant-runtime']

type CloudflareRuntimeEnv = Record<string, string | undefined>
type CloudflareRuntimeEvent = H3Event & {
  context?: H3Event['context'] & {
    cloudflare?: { env?: CloudflareRuntimeEnv }
    _platform?: { cloudflare?: { env?: CloudflareRuntimeEnv } }
    nitro?: { env?: CloudflareRuntimeEnv }
  }
  req?: {
    runtime?: {
      cloudflare?: { env?: CloudflareRuntimeEnv }
    }
  }
}

export interface DataRuntimeManifest {
  name: string
  version: string
  commit: string | null
  builtAt: string | null
  publishedAt: string | null
  platforms: Array<{
    os: string
    arch: string
  }>
}

export type DataRuntimeHealth = NormalizedDataRuntimeHealth

export interface DataRuntimeParameters {
  runtimeApiUrl: string
  packageBaseUrl: string
  audience: string
  tokenConfigured: boolean
}

export interface DataRuntimeOverview {
  parameters: DataRuntimeParameters
  latest: {
    manifest: DataRuntimeManifest | null
    manifestUrl: string
    versionUrl: string
    fetchedAt: string
    error: string | null
  }
  runtime: DataRuntimeHealth
  updateAvailable: boolean
}

export interface DataRuntimeUpdateStatus {
  operationId: string | null
  status: string
  phase: string | null
  running: boolean
  targetVersion: string | null
  packageSourceFingerprint: string | null
  baseUrl: string | null
  serviceName: string | null
  restart: boolean | null
  triggeredAt: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  errorCode: string | null
  result: Record<string, unknown> | null
  observedVersion: string | null
  expectedVersionMatches: boolean | null
  checkedAt: string
  audience: string | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeBaseUrl(value: unknown) {
  return stringValue(value).replace(/\/+$/, '')
}

function assertHttpBaseUrl(value: string, label: string) {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    return normalizeBaseUrl(url.toString())
  } catch {
    throw createError({ statusCode: 400, message: `${label} must be a valid http(s) URL` })
  }
}

function cloudflareEnv(event: H3Event): CloudflareRuntimeEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.context?.nitro?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || {}
}

function envValue(event: H3Event, names: string[]) {
  const env = cloudflareEnv(event)
  for (const name of names) {
    const value = stringValue(env[name])
    if (value) return value
  }
  for (const name of names) {
    const value = stringValue(process.env[name])
    if (value) return value
  }
  return ''
}

function gatewayHeader(event: H3Event, names: string[]) {
  if (!isTrustedTenantGatewayRequest(event)) return ''
  for (const name of names) {
    const value = stringValue(getHeader(event, name))
    if (value) return value
  }
  return ''
}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function errorMessage(error: unknown) {
  const normalized = error as {
    message?: string
    statusMessage?: string
    data?: {
      message?: string
      statusMessage?: string
      error_description?: string
      error?: string | { message?: string }
    }
  }
  const dataError = normalized.data?.error
  return stringValue(
    (dataError && typeof dataError === 'object' ? dataError.message : dataError)
    || normalized.data?.message
    || normalized.data?.statusMessage
    || normalized.data?.error_description
    || normalized.data?.error
    || normalized.statusMessage
    || normalized.message
    || String(error)
  )
}

function normalizePlatforms(value: unknown): DataRuntimeManifest['platforms'] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const platform = item as Record<string, unknown>
      const os = stringValue(platform.os)
      const arch = stringValue(platform.arch)
      return os && arch ? { os, arch } : null
    })
    .filter((item): item is { os: string, arch: string } => Boolean(item))
}

function normalizeManifest(value: unknown, fallbackVersion = ''): DataRuntimeManifest | null {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const version = stringValue(item.version || fallbackVersion)
  if (!version) return null
  const builtAt = stringValue(item.builtAt)
  const publishedAt = stringValue(item.publishedAt || item.releasedAt || item.releaseAt)
  return {
    name: stringValue(item.name) || 'hzy-data-runtime',
    version,
    commit: stringValue(item.commit) || null,
    builtAt: builtAt || null,
    publishedAt: publishedAt || builtAt || null,
    platforms: normalizePlatforms(item.platforms)
  }
}

async function fetchLatestManifest(packageBaseUrl: string) {
  const manifestUrl = appendPath(packageBaseUrl, '/latest/manifest.json')
  const versionUrl = appendPath(packageBaseUrl, '/latest/version.txt')
  const fetchedAt = new Date().toISOString()

  try {
    const manifest = await fetchExternal<Record<string, unknown>>(manifestUrl, {
      timeout: 10000,
      retry: 0
    })
    return {
      manifest: normalizeManifest(manifest),
      manifestUrl,
      versionUrl,
      fetchedAt,
      error: null
    }
  } catch (manifestError) {
    try {
      const version = await fetchExternal<string>(versionUrl, {
        parseResponse: (responseText: string) => responseText,
        timeout: 10000,
        retry: 0
      })
      return {
        manifest: normalizeManifest(null, version),
        manifestUrl,
        versionUrl,
        fetchedAt,
        error: `manifest.json unavailable: ${errorMessage(manifestError)}`
      }
    } catch (versionError) {
      return {
        manifest: null,
        manifestUrl,
        versionUrl,
        fetchedAt,
        error: errorMessage(versionError)
      }
    }
  }
}

async function fetchRuntimeHealth(runtimeApiUrl: string): Promise<DataRuntimeHealth> {
  if (!runtimeApiUrl) {
    return {
      reachable: false,
      healthPath: null,
      runtimeProduct: null,
      status: 'unconfigured',
      version: null,
      commit: null,
      builtAt: null,
      tenant: null,
      deployment: null,
      apps: {},
      raw: null,
      error: 'dataRuntime.runtimeApiUrl is not configured',
      checkedAt: new Date().toISOString()
    }
  }

  let lastError: unknown = null
  for (const healthPath of ['/runtime/healthz', '/runtime/health']) {
    try {
      const health = await fetchExternal<Record<string, unknown>>(appendPath(runtimeApiUrl, healthPath), {
        timeout: 10000,
        retry: 0
      })
      return normalizeDataRuntimeHealth(health, healthPath)
    } catch (error) {
      lastError = error
    }
  }

  return {
    reachable: false,
    healthPath: null,
    runtimeProduct: null,
    status: 'unreachable',
    version: null,
    commit: null,
    builtAt: null,
    tenant: null,
    deployment: null,
    apps: {},
    raw: null,
    error: errorMessage(lastError),
    checkedAt: new Date().toISOString()
  }
}

function resolveRuntimeStaticToken(event: H3Event) {
  const configuredToken = envValue(event, [
    'HZY_TENANT_RUNTIME_TOKEN',
    'HZY_DATA_RUNTIME_TOKEN',
    'HZY_CONSOLE_TENANT_RUNTIME_TOKEN',
    'HZY_CONSOLE_DATA_RUNTIME_TOKEN'
  ])
  if (configuredToken) return configuredToken

  const gatewayToken = gatewayHeader(event, ['x-hzy-tenant-runtime-token', 'x-hzy-data-runtime-token'])
  // Managed Tenant Gateway injects a short-lived Platform bootstrap JWT in
  // this compatibility header. It is only valid for asking Runtime to mint a
  // Console service token and must never be sent directly to /runtime/update.
  if (isPlatformRuntimeBootstrapToken(gatewayToken)) return ''
  return gatewayToken
}

async function resolveRuntimeBearerToken(event: H3Event, audience: string, deploymentCodeOverride?: string | null) {
  const staticToken = resolveRuntimeStaticToken(event)
  if (staticToken) return staticToken
  const normalizedAudience = stringValue(audience) || DEFAULT_AUDIENCE
  return await requestServiceAccessToken({
    audience: normalizedAudience,
    scope: `${normalizedAudience}:runtime:update`,
    deploymentCodeOverride,
    event
  })
}

function candidateAudiences(value: string) {
  const first = stringValue(value) || DEFAULT_AUDIENCE
  return [...new Set([first, ...FALLBACK_AUDIENCES].map(item => stringValue(item)).filter(Boolean))]
}

function responseStatus(error: unknown) {
  const normalized = error as { status?: number, statusCode?: number, response?: { status?: number } }
  return Number(normalized?.statusCode || normalized?.status || normalized?.response?.status || 0) || 502
}

function retryableRuntimeAuthError(error: unknown) {
  const status = responseStatus(error)
  return status === 401 || status === 403
}

function unsupportedUpdateMessage(path: string) {
  if (path === '/runtime/update') {
    return '当前租户 data-runtime 版本不支持远程更新 API。需要先在租户 Linux 服务器上手动运行安装/更新脚本，升级到包含 /runtime/update 的版本；之后 Console 才能通过 API 触发更新。'
  }
  if (path === '/runtime/update/status') {
    return '更新请求已提交，但当前租户 data-runtime 不支持 /runtime/update/status，Console 无法查询后续结果。请查看租户 Linux 服务器上的 hzy-data-runtime 日志或 systemd 状态。'
  }
  return ''
}

function normalizeUpdateStatus(value: unknown, audience: string | null): DataRuntimeUpdateStatus {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    operationId: stringValue(item.operationId) || null,
    status: stringValue(item.status) || 'unknown',
    phase: stringValue(item.phase) || null,
    running: Boolean(item.running || item.status === 'running' || item.status === 'queued'),
    targetVersion: stringValue(item.targetVersion) || null,
    packageSourceFingerprint: stringValue(item.packageSourceFingerprint) || null,
    baseUrl: stringValue(item.baseUrl) || null,
    serviceName: stringValue(item.serviceName) || null,
    restart: typeof item.restart === 'boolean' ? item.restart : null,
    triggeredAt: stringValue(item.triggeredAt) || null,
    startedAt: stringValue(item.startedAt) || null,
    finishedAt: stringValue(item.finishedAt) || null,
    error: stringValue(item.error) || null,
    errorCode: stringValue(item.errorCode) || null,
    result: item.result && typeof item.result === 'object' ? item.result as Record<string, unknown> : null,
    observedVersion: stringValue(item.observedVersion) || null,
    expectedVersionMatches: typeof item.expectedVersionMatches === 'boolean' ? item.expectedVersionMatches : null,
    checkedAt: stringValue(item.checkedAt) || new Date().toISOString(),
    audience
  }
}

async function fetchRuntimeManagement<T>(event: H3Event, input: {
  runtimeApiUrl: string
  audience: string
  path: string
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeout?: number
  runtimeDeployment?: string | null
  preferRuntimeDeployment?: boolean
}): Promise<{ data: T, audience: string | null }> {
  const staticToken = resolveRuntimeStaticToken(event)
  let attempts = staticToken
    ? [{ audience: stringValue(input.audience) || null, token: staticToken }]
    : await Promise.all(candidateAudiences(input.audience).map(async audience => ({
        audience,
        token: await resolveRuntimeBearerToken(event, audience)
      })))
  const runtimeDeployment = stringValue(input.runtimeDeployment)
  if (!staticToken && runtimeDeployment && input.preferRuntimeDeployment) {
    const audience = stringValue(input.audience) || DEFAULT_AUDIENCE
    const runtimeBoundAttempt = {
      audience,
      token: await resolveRuntimeBearerToken(event, audience, runtimeDeployment)
    }
    attempts = [runtimeBoundAttempt, ...attempts]
  }

  let firstError: unknown = null
  let lastError: unknown = null
  for (const [index, attempt] of attempts.entries()) {
    try {
      const data = await fetchExternal<T>(appendPath(input.runtimeApiUrl, input.path), {
        method: input.method || 'GET',
        headers: {
          'authorization': `Bearer ${attempt.token}`,
          'content-type': 'application/json'
        },
        body: input.body,
        timeout: input.timeout || 15000,
        retry: 0
      })
      return { data, audience: attempt.audience }
    } catch (error) {
      firstError ||= error
      lastError = error
      if (!retryableRuntimeAuthError(error) || index === attempts.length - 1) {
        const surfacedError = firstError || error
        const statusCode = responseStatus(surfacedError)
        throw createError({
          statusCode,
          message: statusCode === 404
            ? unsupportedUpdateMessage(input.path) || errorMessage(surfacedError)
            : errorMessage(surfacedError)
        })
      }
    }
  }

  const surfacedError = firstError || lastError
  throw createError({ statusCode: responseStatus(surfacedError), message: errorMessage(surfacedError) })
}

export async function resolveDataRuntimeParameters(event: H3Event): Promise<DataRuntimeParameters> {
  const values = await getSystemParameters([
    'dataRuntime.runtimeApiUrl',
    'dataRuntime.packageBaseUrl',
    'dataRuntime.audience'
  ]).catch(() => ({} as Record<string, string>))

  const runtimeApiUrl = assertHttpBaseUrl(
    gatewayHeader(event, ['x-hzy-tenant-runtime-url', 'x-hzy-data-runtime-url'])
    || values['dataRuntime.runtimeApiUrl']
    || envValue(event, [
      'HZY_TENANT_RUNTIME_URL',
      'HZY_DATA_RUNTIME_URL',
      'HZY_CONSOLE_TENANT_RUNTIME_URL',
      'HZY_CONSOLE_DATA_RUNTIME_URL'
    ]),
    'runtimeApiUrl'
  )
  const packageBaseUrl = assertHttpBaseUrl(
    values['dataRuntime.packageBaseUrl']
    || envValue(event, [
      'HZY_DATA_RUNTIME_PACKAGE_BASE_URL',
      'HZY_TENANT_RUNTIME_PACKAGE_BASE_URL'
    ])
    || DEFAULT_PACKAGE_BASE_URL,
    'packageBaseUrl'
  )
  const audience = stringValue(
    gatewayHeader(event, ['x-hzy-tenant-runtime-audience', 'x-hzy-data-runtime-audience'])
    || values['dataRuntime.audience']
    || envValue(event, [
      'HZY_TENANT_RUNTIME_AUDIENCE',
      'HZY_DATA_RUNTIME_AUDIENCE'
    ])
  ) || DEFAULT_AUDIENCE

  return {
    runtimeApiUrl,
    packageBaseUrl,
    audience,
    tokenConfigured: Boolean(resolveRuntimeStaticToken(event))
  }
}

export async function getDataRuntimeOverview(event: H3Event): Promise<DataRuntimeOverview> {
  const parameters = await resolveDataRuntimeParameters(event)
  const [latest, runtime] = await Promise.all([
    fetchLatestManifest(parameters.packageBaseUrl),
    fetchRuntimeHealth(parameters.runtimeApiUrl)
  ])
  const latestVersion = latest.manifest?.version || ''
  const runtimeVersion = runtime.version || ''

  return {
    parameters,
    latest,
    runtime,
    updateAvailable: Boolean(latestVersion && runtimeVersion && latestVersion !== runtimeVersion)
  }
}

export async function triggerDataRuntimeUpdate(event: H3Event) {
  const overview = await getDataRuntimeOverview(event)
  const runtimeApiUrl = overview.parameters.runtimeApiUrl
  const targetVersion = overview.latest.manifest?.version || ''

  if (!runtimeApiUrl) {
    throw createError({ statusCode: 400, message: 'dataRuntime.runtimeApiUrl is not configured' })
  }
  if (!targetVersion) {
    throw createError({ statusCode: 502, message: overview.latest.error || 'failed to resolve latest data runtime version' })
  }

  const update = await fetchRuntimeManagement<Record<string, unknown>>(event, {
    runtimeApiUrl,
    audience: overview.parameters.audience,
    path: '/runtime/update',
    method: 'POST',
    body: {
      targetVersion
    },
    runtimeDeployment: overview.runtime.deployment,
    preferRuntimeDeployment: overview.runtime.version === '0.3.103',
    timeout: 15000
  })

  return {
    targetVersion,
    runtimeApiUrl,
    updateAvailable: overview.updateAvailable,
    audience: update.audience,
    result: update.data
  }
}

export async function getDataRuntimeUpdateStatus(event: H3Event) {
  const parameters = await resolveDataRuntimeParameters(event)
  if (!parameters.runtimeApiUrl) {
    throw createError({ statusCode: 400, message: 'dataRuntime.runtimeApiUrl is not configured' })
  }

  const runtime = await fetchRuntimeHealth(parameters.runtimeApiUrl)
  const status = await fetchRuntimeManagement<Record<string, unknown>>(event, {
    runtimeApiUrl: parameters.runtimeApiUrl,
    audience: parameters.audience,
    path: '/runtime/update/status',
    method: 'GET',
    runtimeDeployment: runtime.deployment,
    preferRuntimeDeployment: runtime.version === '0.3.103',
    timeout: 10000
  })
  return normalizeUpdateStatus(status.data, status.audience)
}
