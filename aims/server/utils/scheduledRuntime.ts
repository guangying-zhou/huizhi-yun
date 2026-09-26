import { $fetch } from 'ofetch'
import { createHmac } from 'node:crypto'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { isPositiveUint64Decimal } from '@hzy/foundation/shared/utils/unsignedDecimal'
import { unifiedIntegrationOperationRoute } from './unifiedIntegrationOperationRoute'

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
  requireServiceToken?: boolean
  schedulerGeneration?: string
}

type AimsDueNotificationRuntimePath
  = '/v1/aims/service/notifications:scan-due'
    | '/v1/aims/service/notifications:acknowledge'
    | '/v1/aims/service/notifications:acknowledge-closure'

export const aimsDueNotificationWorkerScope = 'aims.notifications_due.execute'
const aimsDueNotificationWorkerClientId = 'aims.runtime'
const aimsDueNotificationWorkerActor = 'aims.scheduled-notification-worker'
const aimsDueNotificationWorkerPurpose = 'aims-due-notification-worker'

function stringValue(value: unknown) {
  return String(value || '').trim()
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
    const value = stringValue(current)
    if (value) return value
  }
  return ''
}

function envValue(names: string[]) {
  for (const name of names) {
    const value = stringValue(process.env[name])
    if (value) return value
  }
  return ''
}

function isManagedCloud(config: Record<string, unknown>) {
  const profile = (getConfigValue(config, ['hzy.deploymentProfile', 'public.deploymentProfile'])
    || envValue(['HZY_DEPLOYMENT_PROFILE', 'NUXT_PUBLIC_DEPLOYMENT_PROFILE'])).toLowerCase()
  return profile.startsWith('managed-cloud')
}

function scheduledRuntimeEndpoint(config: Record<string, unknown>) {
  return getConfigValue(config, [
    'hzy.tenantRuntime.endpoint',
    'tenantRuntime.endpoint',
    'hzy.dataRuntime.endpoint',
    'dataRuntime.endpoint'
  ]) || envValue([
    'HZY_AIMS_TENANT_RUNTIME_URL',
    'HZY_TENANT_RUNTIME_URL',
    'HZY_AIMS_DATA_RUNTIME_URL',
    'HZY_DATA_RUNTIME_URL'
  ])
}

function scheduledRuntimeStaticToken(config: Record<string, unknown>) {
  return getConfigValue(config, [
    'hzy.tenantRuntime.token',
    'tenantRuntime.token',
    'hzy.dataRuntime.token',
    'dataRuntime.token'
  ]) || envValue([
    'HZY_AIMS_TENANT_RUNTIME_TOKEN',
    'HZY_TENANT_RUNTIME_TOKEN',
    'HZY_AIMS_DATA_RUNTIME_TOKEN',
    'HZY_DATA_RUNTIME_TOKEN'
  ])
}

function scheduledRuntimeAudience(config: Record<string, unknown>) {
  return envValue(['HZY_DATA_RUNTIME_AUDIENCE'])
    || getConfigValue(config, ['hzy.dataRuntime.audience', 'dataRuntime.audience'])
    || getConfigValue(config, ['hzy.tenantRuntime.audience', 'tenantRuntime.audience'])
    || envValue(['HZY_TENANT_RUNTIME_AUDIENCE'])
    || 'data-runtime'
}

function scheduledRuntimeContextHeaders(config: Record<string, unknown>) {
  const tenant = getConfigValue(config, [
    'hzy.tenantRuntime.tenant',
    'tenantRuntime.tenant',
    'hzy.dataRuntime.tenant',
    'dataRuntime.tenant'
  ]) || envValue(['HZY_TENANT_RUNTIME_TENANT', 'HZY_DATA_RUNTIME_TENANT'])
  const deployment = getConfigValue(config, [
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

export function requireAimsScheduledRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const endpoint = scheduledRuntimeEndpoint(config)
  const headers = scheduledRuntimeContextHeaders(config)
  const tenant = stringValue(headers['x-hzy-tenant'])
  const deployment = stringValue(headers['x-hzy-deployment'])
  const financeTargetDeployment = envValue(['HZY_FINANCE_TARGET_DEPLOYMENT'])
  const altocTargetDeployment = envValue(['HZY_ALTOC_TARGET_DEPLOYMENT'])
  const codocsTargetDeployment = envValue(['HZY_CODOCS_TARGET_DEPLOYMENT'])
  const workflowTargetDeployment = envValue(['HZY_WORKFLOW_TARGET_DEPLOYMENT'])
  if (!endpoint || !tenant || !deployment) {
    throw new Error('Aims scheduled runtime requires an explicit tenant-runtime endpoint, tenant and deployment binding.')
  }
  if (isManagedCloud(config)) {
    const clientId = getConfigValue(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'])
      || envValue(['HZY_AIMS_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
    const clientSecret = getConfigValue(config, ['hzy.serviceClient.clientSecret', 'serviceClient.clientSecret'])
      || envValue(['HZY_AIMS_SERVICE_CLIENT_SECRET', 'HZY_SERVICE_CLIENT_SECRET'])
    if (!clientId || !clientSecret) {
      throw new Error('Aims managed Cloudflare drain requires a dedicated Console service client.')
    }
  }
  return { endpoint, tenant, deployment, codocsTargetDeployment, altocTargetDeployment, financeTargetDeployment, workflowTargetDeployment }
}

export function requireAimsDueNotificationRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireAimsScheduledRuntimeBinding()
  const clientId = getConfigValue(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'])
    || envValue(['HZY_AIMS_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
  if (clientId !== aimsDueNotificationWorkerClientId) {
    throw new Error('Aims due-notification tasks require the dedicated aims.runtime service client.')
  }
  if (scheduledRuntimeStaticToken(config)) {
    throw new Error('Aims due-notification tasks require a short-lived aims.runtime service token, not a static runtime token.')
  }
  return binding
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

async function scheduledRuntimeBearerToken(config: Record<string, unknown>, scope: string, requireServiceToken = false) {
  const staticToken = scheduledRuntimeStaticToken(config)
  if (staticToken) {
    if (requireServiceToken) throw new Error('This scheduled operation requires a short-lived service token.')
    if (isManagedCloud(config)) throw new Error('Aims managed Cloudflare scheduled tasks must not use a static runtime token.')
    return staticToken
  }

  const audience = scheduledRuntimeAudience(config)
  return await requestServiceAccessToken({
    audience,
    scope: tenantRuntimeTokenScope(audience, scope)
  })
}

export async function callAimsScheduledRuntime<T>(
  path: string,
  options: ScheduledRuntimeOptions
): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const endpoint = scheduledRuntimeEndpoint(config)
  if (!endpoint) {
    throw new Error('Aims tenant-runtime endpoint is not configured for scheduled task.')
  }

  const url = new URL(path, endpoint.endsWith('/') ? endpoint : `${endpoint}/`)
  const method = options.method || 'POST'
  const data = await $fetch<RuntimeEnvelope<T>>(url.toString(), {
    method,
    headers: {
      authorization: `Bearer ${await scheduledRuntimeBearerToken(config, options.scope, options.requireServiceToken)}`,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(stringValue(options.requestId) ? { 'x-request-id': stringValue(options.requestId) } : {}),
      ...(options.schedulerGeneration ? { 'x-hzy-scheduler-generation': options.schedulerGeneration } : {}),
      ...scheduledRuntimeContextHeaders(config)
    },
    ...(method === 'GET' ? {} : { body: options.body ?? {} }),
    timeout: 10000
  })
  if (data.code !== undefined && data.code !== 0) {
    throw new Error(data.message || 'Aims tenant-runtime returned an error.')
  }
  return data.data as T
}

// Selected by a migrated worker only after its complete task ownership and
// notification paths have been verified. This does not enable a cron.
export async function callAimsUnifiedIntegrationOperationRuntime<T>(path: string, body: Record<string, unknown>, requestId: string, generation: string): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const clientId = getConfigValue(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'])
    || envValue(['HZY_AIMS_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
  if (clientId !== 'aims.runtime' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,221}$/.test(requestId)) {
    throw new Error('Unified scheduler requires aims.runtime and a stable request identity.')
  }
  if (!isPositiveUint64Decimal(generation)) {
    throw new Error('Unified scheduler requires an explicit uint64 generation.')
  }
  requireAimsScheduledRuntimeBinding()
  const routed = unifiedIntegrationOperationRoute(path, body)
  return await callAimsScheduledRuntime<T>(routed.path, {
    scope: 'aims:integration_operation:execute',
    body: routed.body,
    requestId,
    schedulerGeneration: generation,
    requireServiceToken: true
  })
}

// Due checkpoint scans and acknowledgements are a closed worker contract, not
// general Aims writes. Bind its fixed worker identity to the exact request
// target with the same short-lived bearer validated by data-runtime.
export async function callAimsDueNotificationRuntime<T>(path: AimsDueNotificationRuntimePath, body: Record<string, unknown>): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireAimsDueNotificationRuntimeBinding()
  const url = new URL(path, binding.endpoint.endsWith('/') ? binding.endpoint : `${binding.endpoint}/`)
  const token = await scheduledRuntimeBearerToken(config, aimsDueNotificationWorkerScope)
  const signedAt = String(Date.now())
  const canonical = ['POST', url.pathname + url.search, aimsDueNotificationWorkerActor, '', signedAt, aimsDueNotificationWorkerPurpose].join('\n')
  const signature = createHmac('sha256', token).update(canonical).digest('base64url')
  const data = await $fetch<RuntimeEnvelope<T>>(url.toString(), {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'x-hzy-tenant': binding.tenant,
      'x-hzy-deployment': binding.deployment,
      'x-hzy-actor-uid': aimsDueNotificationWorkerActor,
      'x-hzy-actor-signed-at': signedAt,
      'x-hzy-actor-purpose': aimsDueNotificationWorkerPurpose,
      'x-hzy-actor-signature': signature
    },
    body,
    timeout: 10000
  })
  if (data.code !== undefined && data.code !== 0) throw new Error(data.message || 'Aims tenant-runtime returned an error.')
  return data.data as T
}
