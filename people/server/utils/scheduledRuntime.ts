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
}

type PeopleDueNotificationRuntimePath
  = '/v1/people/service/notifications:scan-due'
    | '/v1/people/service/notifications:acknowledge'
    | '/v1/people/service/notifications:acknowledge-closure'

export const peopleDueNotificationWorkerScope = 'people.notifications_due.execute'
const peopleDueNotificationWorkerClientId = 'people.runtime'
const peopleDueNotificationWorkerActor = 'people.scheduled-offboarding-notification-worker'
const peopleDueNotificationWorkerPurpose = 'people-offboarding-due-notification-worker'
const workerServiceUserAgent = 'HZY-Cloudflare-Worker/1.0'

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
    const result = text(current)
    if (result) return result
  }
  return ''
}

function envValue(names: string[]) {
  for (const name of names) {
    const result = text(process.env[name])
    if (result) return result
  }
  return ''
}

function isManagedCloud(config: Record<string, unknown>) {
  const profile = (configValue(config, ['hzy.deploymentProfile', 'public.deploymentProfile'])
    || envValue(['HZY_DEPLOYMENT_PROFILE', 'NUXT_PUBLIC_DEPLOYMENT_PROFILE'])).toLowerCase()
  return profile.startsWith('managed-cloud')
}

function endpoint(config: Record<string, unknown>) {
  return configValue(config, ['hzy.tenantRuntime.endpoint', 'tenantRuntime.endpoint'])
    || envValue(['HZY_PEOPLE_TENANT_RUNTIME_URL', 'HZY_TENANT_RUNTIME_URL', 'HZY_PEOPLE_DATA_RUNTIME_URL', 'HZY_DATA_RUNTIME_URL'])
}

function staticToken(config: Record<string, unknown>) {
  return configValue(config, ['hzy.tenantRuntime.token', 'tenantRuntime.token'])
    || envValue(['HZY_PEOPLE_TENANT_RUNTIME_TOKEN', 'HZY_TENANT_RUNTIME_TOKEN', 'HZY_PEOPLE_DATA_RUNTIME_TOKEN', 'HZY_DATA_RUNTIME_TOKEN'])
}

function contextHeaders(config: Record<string, unknown>) {
  const tenant = configValue(config, ['hzy.tenantRuntime.tenant', 'tenantRuntime.tenant'])
    || envValue(['HZY_TENANT_RUNTIME_TENANT', 'HZY_DATA_RUNTIME_TENANT'])
  const deployment = configValue(config, ['hzy.tenantRuntime.deployment', 'tenantRuntime.deployment'])
    || envValue(['HZY_TENANT_RUNTIME_DEPLOYMENT', 'HZY_DATA_RUNTIME_DEPLOYMENT'])
  return {
    ...(tenant ? { 'x-hzy-tenant': tenant } : {}),
    ...(deployment ? { 'x-hzy-deployment': deployment } : {})
  }
}

function audience(config: Record<string, unknown>) {
  return envValue(['HZY_DATA_RUNTIME_AUDIENCE', 'HZY_TENANT_RUNTIME_AUDIENCE'])
    || configValue(config, ['hzy.tenantRuntime.audience', 'tenantRuntime.audience'])
    || 'data-runtime'
}

export function requirePeopleScheduledRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const runtimeEndpoint = endpoint(config)
  const headers = contextHeaders(config)
  const tenant = text(headers['x-hzy-tenant'])
  const deployment = text(headers['x-hzy-deployment'])
  if (!runtimeEndpoint || !tenant || !deployment) {
    throw new Error('People scheduled runtime requires an explicit endpoint, tenant and deployment binding.')
  }
  if (isManagedCloud(config)) {
    const clientId = configValue(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'])
      || envValue(['HZY_PEOPLE_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
    const clientSecret = configValue(config, ['hzy.serviceClient.clientSecret', 'serviceClient.clientSecret'])
      || envValue(['HZY_PEOPLE_SERVICE_CLIENT_SECRET', 'HZY_SERVICE_CLIENT_SECRET'])
    if (!clientId || !clientSecret) {
      throw new Error('People managed Cloudflare scheduled tasks require a dedicated Console service client.')
    }
  }
  return { endpoint: runtimeEndpoint, tenant, deployment }
}

export function requirePeopleDueNotificationRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requirePeopleScheduledRuntimeBinding()
  const clientId = configValue(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'])
    || envValue(['HZY_PEOPLE_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
  if (clientId !== peopleDueNotificationWorkerClientId) throw new Error('People offboarding due tasks require the dedicated people.runtime service client.')
  if (staticToken(config)) throw new Error('People offboarding due tasks require a short-lived people.runtime service token, not a static runtime token.')
  return binding
}

function runtimeTokenScope(targetAudience: string, scope: string) {
  if (scope.startsWith(`${targetAudience}:`)) return scope
  const [appCode, action] = scope.split(/\.(.+)/).filter(Boolean)
  return appCode && action ? `${targetAudience}:${appCode}:${action}` : scope
}

async function bearerToken(config: Record<string, unknown>, scope: string) {
  const configured = staticToken(config)
  if (configured) {
    if (isManagedCloud(config)) {
      throw new Error('People managed Cloudflare scheduled tasks must not use a static runtime token.')
    }
    return configured
  }
  const targetAudience = audience(config)
  return await requestServiceAccessToken({
    audience: targetAudience,
    scope: runtimeTokenScope(targetAudience, scope)
  })
}

export async function callPeopleScheduledRuntime<T>(
  path: string,
  options: ScheduledRuntimeOptions
): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const runtimeEndpoint = endpoint(config)
  if (!runtimeEndpoint) throw new Error('People tenant-runtime endpoint is not configured for scheduled task.')
  const url = new URL(path, runtimeEndpoint.endsWith('/') ? runtimeEndpoint : `${runtimeEndpoint}/`)
  const method = options.method || 'POST'
  const response = await $fetch<RuntimeEnvelope<T>>(url.toString(), {
    method,
    headers: {
      'authorization': `Bearer ${await bearerToken(config, options.scope)}`,
      'user-agent': workerServiceUserAgent,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...contextHeaders(config)
    },
    ...(method === 'GET' ? {} : { body: options.body ?? {} }),
    timeout: 10000
  })
  if (response.code !== undefined && response.code !== 0) {
    throw new Error(response.message || 'People tenant-runtime returned an error.')
  }
  return response.data as T
}

export async function callPeopleDueNotificationRuntime<T>(path: PeopleDueNotificationRuntimePath, body: Record<string, unknown>): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requirePeopleDueNotificationRuntimeBinding()
  const url = new URL(path, binding.endpoint.endsWith('/') ? binding.endpoint : `${binding.endpoint}/`)
  const token = await bearerToken(config, peopleDueNotificationWorkerScope)
  const signedAt = String(Date.now())
  const canonical = ['POST', url.pathname + url.search, peopleDueNotificationWorkerActor, '', signedAt, peopleDueNotificationWorkerPurpose].join('\n')
  const signature = createHmac('sha256', token).update(canonical).digest('base64url')
  const response = await $fetch<RuntimeEnvelope<T>>(url.toString(), {
    method: 'POST', headers: {
      'authorization': `Bearer ${token}`, 'content-type': 'application/json',
      'user-agent': workerServiceUserAgent,
      'x-hzy-tenant': binding.tenant, 'x-hzy-deployment': binding.deployment,
      'x-hzy-actor-uid': peopleDueNotificationWorkerActor,
      'x-hzy-actor-signed-at': signedAt,
      'x-hzy-actor-purpose': peopleDueNotificationWorkerPurpose,
      'x-hzy-actor-signature': signature
    }, body, timeout: 10000
  })
  if (response.code !== undefined && response.code !== 0) throw new Error(response.message || 'People tenant-runtime returned an error.')
  return response.data as T
}
