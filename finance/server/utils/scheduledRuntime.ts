import { $fetch } from 'ofetch'
import { createHmac } from 'node:crypto'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

interface RuntimeEnvelope<T> { code?: number, data?: T, message?: string }
interface Options { scope: string, body?: Record<string, unknown> }
type FinanceDueNotificationRuntimePath
  = '/v1/finance/service/notifications:scan-due'
    | '/v1/finance/service/notifications:acknowledge'
    | '/v1/finance/service/notifications:acknowledge-closure'

export const financeDueNotificationWorkerScope = 'finance.notifications_due.execute'
const financeDueNotificationWorkerClientId = 'finance.runtime'
const financeDueNotificationWorkerActor = 'finance.scheduled-notification-worker'
const financeDueNotificationWorkerPurpose = 'finance-due-notification-worker'
function text(value: unknown) {
  return String(value || '').trim()
}
function value(config: Record<string, unknown>, path: string) {
  let current: unknown = config
  for (const part of path.split('.')) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined
  return text(current)
}
function configured(config: Record<string, unknown>, paths: string[], envs: string[]) {
  for (const path of paths) if (value(config, path)) return value(config, path)
  for (const name of envs) if (text(process.env[name])) return text(process.env[name])
  return ''
}
function endpoint(config: Record<string, unknown>) {
  return configured(config, ['hzy.tenantRuntime.endpoint', 'tenantRuntime.endpoint'], ['HZY_FINANCE_TENANT_RUNTIME_URL', 'HZY_TENANT_RUNTIME_URL', 'HZY_FINANCE_DATA_RUNTIME_URL', 'HZY_DATA_RUNTIME_URL'])
}
function tenant(config: Record<string, unknown>) {
  return configured(config, ['hzy.tenantRuntime.tenant', 'tenantRuntime.tenant'], ['HZY_TENANT_RUNTIME_TENANT', 'HZY_DATA_RUNTIME_TENANT'])
}
function deployment(config: Record<string, unknown>) {
  return configured(config, ['hzy.tenantRuntime.deployment', 'tenantRuntime.deployment'], ['HZY_TENANT_RUNTIME_DEPLOYMENT', 'HZY_DATA_RUNTIME_DEPLOYMENT'])
}
function managed(config: Record<string, unknown>) {
  return configured(config, ['hzy.deploymentProfile', 'public.deploymentProfile'], ['HZY_DEPLOYMENT_PROFILE', 'NUXT_PUBLIC_DEPLOYMENT_PROFILE']).toLowerCase().startsWith('managed-cloud')
}

function serviceClientId(config: Record<string, unknown>) {
  return text(process.env.HZY_FINANCE_SERVICE_CLIENT_ID)
    || configured(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'], ['HZY_SERVICE_CLIENT_ID'])
}

function serviceClientSecret(config: Record<string, unknown>) {
  return text(process.env.HZY_FINANCE_SERVICE_CLIENT_SECRET)
    || configured(config, ['hzy.serviceClient.clientSecret', 'serviceClient.clientSecret'], ['HZY_SERVICE_CLIENT_SECRET'])
}

export function requireFinanceScheduledRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = { endpoint: endpoint(config), tenant: tenant(config), deployment: deployment(config) }
  if (!binding.endpoint || !binding.tenant || !binding.deployment) throw new Error('Finance scheduled runtime requires an explicit endpoint, tenant and deployment binding.')
  if (managed(config)) {
    const clientId = serviceClientId(config)
    const clientSecret = serviceClientSecret(config)
    if (!clientId || !clientSecret) throw new Error('Finance managed Cloudflare scheduled tasks require a dedicated Console service client.')
  }
  return binding
}

export function requireFinanceDueNotificationRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireFinanceScheduledRuntimeBinding()
  if (serviceClientId(config) !== financeDueNotificationWorkerClientId) {
    throw new Error('Finance due-notification tasks require the dedicated finance.runtime service client.')
  }
  if (configured(config, ['hzy.tenantRuntime.token', 'tenantRuntime.token'], ['HZY_FINANCE_TENANT_RUNTIME_TOKEN', 'HZY_TENANT_RUNTIME_TOKEN', 'HZY_FINANCE_DATA_RUNTIME_TOKEN', 'HZY_DATA_RUNTIME_TOKEN'])) {
    throw new Error('Finance due-notification tasks require a short-lived finance.runtime service token, not a static runtime token.')
  }
  return binding
}

async function bearer(config: Record<string, unknown>, scope: string) {
  const staticToken = configured(config, ['hzy.tenantRuntime.token', 'tenantRuntime.token'], ['HZY_FINANCE_TENANT_RUNTIME_TOKEN', 'HZY_TENANT_RUNTIME_TOKEN', 'HZY_FINANCE_DATA_RUNTIME_TOKEN', 'HZY_DATA_RUNTIME_TOKEN'])
  if (staticToken) {
    if (managed(config)) throw new Error('Finance managed Cloudflare scheduled tasks must not use a static runtime token.')
    return staticToken
  }
  const audience = configured(config, ['hzy.tenantRuntime.audience', 'tenantRuntime.audience'], ['HZY_DATA_RUNTIME_AUDIENCE', 'HZY_TENANT_RUNTIME_AUDIENCE']) || 'data-runtime'
  const [app, action] = scope.split(/\.(.+)/).filter(Boolean)
  return await requestServiceAccessToken({ audience, scope: app && action ? `${audience}:${app}:${action}` : scope })
}

export async function callFinanceScheduledRuntime<T>(path: string, options: Options): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireFinanceScheduledRuntimeBinding()
  const response = await $fetch<RuntimeEnvelope<T>>(new URL(path, binding.endpoint.endsWith('/') ? binding.endpoint : `${binding.endpoint}/`).toString(), {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${await bearer(config, options.scope)}`,
      'content-type': 'application/json',
      'x-hzy-tenant': binding.tenant,
      'x-hzy-deployment': binding.deployment
    },
    body: options.body || {},
    timeout: 10000
  })
  if (response.code !== undefined && response.code !== 0) throw new Error(response.message || 'Finance tenant-runtime returned an error.')
  return response.data as T
}

// Due checkpoint scans and acknowledgements are a closed worker contract, not
// normal Finance writes. In addition to the exact Console grant, bind a fixed
// worker identity and purpose to this exact request target with the short-lived
// runtime bearer; the runtime rejects normal finance.write callers.
export async function callFinanceDueNotificationRuntime<T>(path: FinanceDueNotificationRuntimePath, body: Record<string, unknown>): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireFinanceDueNotificationRuntimeBinding()
  const runtimeUrl = new URL(path, binding.endpoint.endsWith('/') ? binding.endpoint : `${binding.endpoint}/`)
  const token = await bearer(config, financeDueNotificationWorkerScope)
  const signedAt = String(Date.now())
  const canonical = [
    'POST', runtimeUrl.pathname + runtimeUrl.search, financeDueNotificationWorkerActor, '', signedAt, financeDueNotificationWorkerPurpose
  ].join('\n')
  const signature = createHmac('sha256', token).update(canonical).digest('base64url')
  const response = await $fetch<RuntimeEnvelope<T>>(runtimeUrl.toString(), {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'x-hzy-tenant': binding.tenant,
      'x-hzy-deployment': binding.deployment,
      'x-hzy-actor-uid': financeDueNotificationWorkerActor,
      'x-hzy-actor-signed-at': signedAt,
      'x-hzy-actor-purpose': financeDueNotificationWorkerPurpose,
      'x-hzy-actor-signature': signature
    },
    body,
    timeout: 10000
  })
  if (response.code !== undefined && response.code !== 0) throw new Error(response.message || 'Finance tenant-runtime returned an error.')
  return response.data as T
}
