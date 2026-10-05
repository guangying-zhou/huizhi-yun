import { $fetch } from 'ofetch'
import { createHmac } from 'node:crypto'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ScheduledRuntimeOptions {
  scope: string
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  requestId?: string
}

type AssetsDueNotificationRuntimePath
  = '/v1/assets/service/notifications:scan-due'
    | '/v1/assets/service/notifications:acknowledge'
    | '/v1/assets/service/notifications:acknowledge-closure'

export const assetsDueNotificationWorkerScope = 'assets.notifications_due.execute'
const assetsDueNotificationWorkerClientId = 'assets.runtime'
const assetsDueNotificationWorkerActor = 'assets.scheduled-notification-worker'
const assetsDueNotificationWorkerPurpose = 'assets-due-notification-worker'

function text(value: unknown) {
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
    const value = text(current)
    if (value) return value
  }
  return ''
}

function envValue(names: string[]) {
  for (const name of names) {
    const value = text(process.env[name])
    if (value) return value
  }
  return ''
}

function isManagedCloud(config: Record<string, unknown>) {
  const profile = (configValue(config, ['hzy.deploymentProfile', 'public.deploymentProfile'])
    || envValue(['HZY_DEPLOYMENT_PROFILE', 'NUXT_PUBLIC_DEPLOYMENT_PROFILE'])).toLowerCase()
  return profile.startsWith('managed-cloud')
}

function endpoint(config: Record<string, unknown>) {
  return configValue(config, [
    'hzy.tenantRuntime.endpoint',
    'tenantRuntime.endpoint',
    'hzy.dataRuntime.endpoint',
    'dataRuntime.endpoint'
  ]) || envValue([
    'HZY_ASSETS_TENANT_RUNTIME_URL',
    'HZY_TENANT_RUNTIME_URL',
    'HZY_ASSETS_DATA_RUNTIME_URL',
    'HZY_DATA_RUNTIME_URL'
  ])
}

function staticToken(config: Record<string, unknown>) {
  return configValue(config, [
    'hzy.tenantRuntime.token',
    'tenantRuntime.token',
    'hzy.dataRuntime.token',
    'dataRuntime.token'
  ]) || envValue([
    'HZY_ASSETS_TENANT_RUNTIME_TOKEN',
    'HZY_TENANT_RUNTIME_TOKEN',
    'HZY_ASSETS_DATA_RUNTIME_TOKEN',
    'HZY_DATA_RUNTIME_TOKEN'
  ])
}

function audience(config: Record<string, unknown>) {
  return envValue(['HZY_DATA_RUNTIME_AUDIENCE'])
    || configValue(config, ['hzy.dataRuntime.audience', 'dataRuntime.audience'])
    || configValue(config, ['hzy.tenantRuntime.audience', 'tenantRuntime.audience'])
    || envValue(['HZY_TENANT_RUNTIME_AUDIENCE'])
    || 'data-runtime'
}

function contextHeaders(config: Record<string, unknown>) {
  const tenant = configValue(config, [
    'hzy.tenantRuntime.tenant',
    'tenantRuntime.tenant',
    'hzy.dataRuntime.tenant',
    'dataRuntime.tenant'
  ]) || envValue(['HZY_TENANT_RUNTIME_TENANT', 'HZY_DATA_RUNTIME_TENANT'])
  const deployment = configValue(config, [
    'hzy.tenantRuntime.deployment',
    'tenantRuntime.deployment',
    'hzy.dataRuntime.deployment',
    'dataRuntime.deployment'
  ]) || envValue(['HZY_TENANT_RUNTIME_DEPLOYMENT', 'HZY_DATA_RUNTIME_DEPLOYMENT'])
  return {
    ...(tenant ? { 'x-hzy-tenant': tenant } : {}),
    ...(deployment ? { 'x-hzy-deployment': deployment } : {})
  }
}

export function requireAssetsScheduledRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const runtimeEndpoint = endpoint(config)
  const headers = contextHeaders(config)
  const tenant = text(headers['x-hzy-tenant'])
  const deployment = text(headers['x-hzy-deployment'])
  if (!runtimeEndpoint || !tenant || !deployment) {
    throw new Error('Assets scheduled runtime requires an explicit endpoint, tenant and deployment binding.')
  }
  if (isManagedCloud(config)) {
    const clientId = configValue(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'])
      || envValue(['HZY_ASSETS_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
    const clientSecret = configValue(config, ['hzy.serviceClient.clientSecret', 'serviceClient.clientSecret'])
      || envValue(['HZY_ASSETS_SERVICE_CLIENT_SECRET', 'HZY_SERVICE_CLIENT_SECRET'])
    if (!clientId || !clientSecret) {
      throw new Error('Assets managed Cloudflare scheduled tasks require a dedicated Console service client.')
    }
  }
  return { endpoint: runtimeEndpoint, tenant, deployment }
}

export function requireAssetsDueNotificationRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireAssetsScheduledRuntimeBinding()
  const clientId = configValue(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'])
    || envValue(['HZY_ASSETS_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
  if (clientId !== assetsDueNotificationWorkerClientId) throw new Error('Assets due-notification tasks require the dedicated assets.runtime service client.')
  if (staticToken(config)) throw new Error('Assets due-notification tasks require a short-lived assets.runtime service token, not a static runtime token.')
  return binding
}

function runtimeTokenScope(targetAudience: string, scope: string): string {
  const normalizedAudience = text(targetAudience)
  const normalizedScope = text(scope)
  if (!normalizedAudience || !normalizedScope) return normalizedScope
  const scopes = normalizedScope.split(/\s+/).filter(Boolean)
  if (scopes.length > 1) return scopes.map(item => runtimeTokenScope(normalizedAudience, item)).join(' ')
  if (normalizedScope.startsWith(`${normalizedAudience}:`)) return normalizedScope
  const [appCode, action] = normalizedScope.split(/\.(.+)/).filter(Boolean)
  return appCode && action ? `${normalizedAudience}:${appCode}:${action}` : normalizedScope
}

async function bearerToken(config: Record<string, unknown>, scope: string) {
  const configuredStaticToken = staticToken(config)
  if (configuredStaticToken) {
    if (isManagedCloud(config)) {
      throw new Error('Assets managed Cloudflare scheduled tasks must not use a static runtime token.')
    }
    return configuredStaticToken
  }
  const targetAudience = audience(config)
  return await requestServiceAccessToken({
    audience: targetAudience,
    scope: runtimeTokenScope(targetAudience, scope)
  })
}

export async function callAssetsScheduledRuntime<T>(
  path: string,
  options: ScheduledRuntimeOptions
): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const runtimeEndpoint = endpoint(config)
  if (!runtimeEndpoint) throw new Error('Assets tenant-runtime endpoint is not configured for scheduled task.')

  const url = new URL(path, runtimeEndpoint.endsWith('/') ? runtimeEndpoint : `${runtimeEndpoint}/`)
  const method = options.method || 'POST'
  const data = await $fetch<RuntimeEnvelope<T>>(url.toString(), {
    method,
    headers: {
      authorization: `Bearer ${await bearerToken(config, options.scope)}`,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(text(options.requestId) ? { 'x-request-id': text(options.requestId) } : {}),
      ...contextHeaders(config)
    },
    ...(method === 'GET' ? {} : { body: options.body ?? {} }),
    timeout: 10000
  })
  if (data.code !== undefined && data.code !== 0) {
    throw new Error(data.message || 'Assets tenant-runtime returned an error.')
  }
  return data.data as T
}

export async function callAssetsDueNotificationRuntime<T>(path: AssetsDueNotificationRuntimePath, body: Record<string, unknown>): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireAssetsDueNotificationRuntimeBinding()
  const url = new URL(path, binding.endpoint.endsWith('/') ? binding.endpoint : `${binding.endpoint}/`)
  const token = await bearerToken(config, assetsDueNotificationWorkerScope)
  const signedAt = String(Date.now())
  const canonical = ['POST', url.pathname + url.search, assetsDueNotificationWorkerActor, '', signedAt, assetsDueNotificationWorkerPurpose].join('\n')
  const signature = createHmac('sha256', token).update(canonical).digest('base64url')
  const data = await $fetch<RuntimeEnvelope<T>>(url.toString(), {
    method: 'POST', headers: {
      'authorization': `Bearer ${token}`, 'content-type': 'application/json',
      'x-hzy-tenant': binding.tenant, 'x-hzy-deployment': binding.deployment,
      'x-hzy-actor-uid': assetsDueNotificationWorkerActor,
      'x-hzy-actor-signed-at': signedAt,
      'x-hzy-actor-purpose': assetsDueNotificationWorkerPurpose,
      'x-hzy-actor-signature': signature
    }, body, timeout: 10000
  })
  if (data.code !== undefined && data.code !== 0) throw new Error(data.message || 'Assets tenant-runtime returned an error.')
  return data.data as T
}
