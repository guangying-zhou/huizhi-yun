import { $fetch } from 'ofetch'
import { createHmac } from 'node:crypto'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

type AltocReceivableDueRuntimePath
  = '/v1/altoc/service/notifications:scan-due'
    | '/v1/altoc/service/notifications:acknowledge'
    | '/v1/altoc/service/notifications:acknowledge-closure'

export const altocReceivableDueWorkerScope = 'altoc.notifications_due.execute'
const altocReceivableDueWorkerClientId = 'altoc.runtime'
const altocReceivableDueWorkerActor = 'altoc.scheduled-receivable-notification-worker'
const altocReceivableDueWorkerPurpose = 'altoc-receivable-due-notification-worker'

function text(value: unknown) {
  return String(value || '').trim()
}
function nested(config: Record<string, unknown>, path: string) {
  let current: unknown = config
  for (const part of path.split('.')) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined
  return text(current)
}
function setting(config: Record<string, unknown>, paths: string[], envs: string[]) {
  for (const path of paths) if (nested(config, path)) return nested(config, path)
  for (const env of envs) if (text(process.env[env])) return text(process.env[env])
  return ''
}
function managed(config: Record<string, unknown>) {
  return setting(config, ['hzy.deploymentProfile', 'public.deploymentProfile'], ['HZY_DEPLOYMENT_PROFILE', 'NUXT_PUBLIC_DEPLOYMENT_PROFILE']).toLowerCase().startsWith('managed-cloud')
}
export function requireAltocReceivableRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const endpoint = setting(config, ['hzy.tenantRuntime.endpoint'], ['HZY_ALTOC_TENANT_RUNTIME_URL', 'HZY_TENANT_RUNTIME_URL', 'HZY_ALTOC_DATA_RUNTIME_URL', 'HZY_DATA_RUNTIME_URL'])
  const tenant = setting(config, ['hzy.tenantRuntime.tenant'], ['HZY_TENANT_RUNTIME_TENANT', 'HZY_DATA_RUNTIME_TENANT'])
  const deployment = setting(config, ['hzy.tenantRuntime.deployment'], ['HZY_TENANT_RUNTIME_DEPLOYMENT', 'HZY_DATA_RUNTIME_DEPLOYMENT'])
  if (!endpoint || !tenant || !deployment) throw new Error('Altoc receivable notifications require explicit runtime endpoint, tenant and deployment.')
  if (managed(config)) {
    const clientId = setting(config, ['hzy.serviceClient.clientId'], ['HZY_ALTOC_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
    const clientSecret = setting(config, ['hzy.serviceClient.clientSecret'], ['HZY_ALTOC_SERVICE_CLIENT_SECRET', 'HZY_SERVICE_CLIENT_SECRET'])
    if (!clientId || !clientSecret) throw new Error('Altoc managed scheduled notifications require a dedicated Console service client ID and secret.')
  }
  return { endpoint, tenant, deployment }
}
export function requireAltocReceivableDueRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireAltocReceivableRuntimeBinding()
  const clientId = setting(config, ['hzy.serviceClient.clientId', 'serviceClient.clientId'], ['HZY_ALTOC_SERVICE_CLIENT_ID', 'HZY_SERVICE_CLIENT_ID'])
  if (clientId !== altocReceivableDueWorkerClientId) throw new Error('Altoc receivable due tasks require the dedicated altoc.runtime service client.')
  if (setting(config, ['hzy.tenantRuntime.token', 'tenantRuntime.token'], ['HZY_ALTOC_TENANT_RUNTIME_TOKEN', 'HZY_TENANT_RUNTIME_TOKEN', 'HZY_ALTOC_DATA_RUNTIME_TOKEN', 'HZY_DATA_RUNTIME_TOKEN'])) {
    throw new Error('Altoc receivable due tasks require a short-lived altoc.runtime service token, not a static runtime token.')
  }
  return binding
}
async function token(config: Record<string, unknown>, scope: string) {
  const staticToken = setting(config, ['hzy.tenantRuntime.token'], ['HZY_ALTOC_TENANT_RUNTIME_TOKEN', 'HZY_TENANT_RUNTIME_TOKEN', 'HZY_ALTOC_DATA_RUNTIME_TOKEN', 'HZY_DATA_RUNTIME_TOKEN'])
  if (staticToken) {
    if (managed(config)) throw new Error('Altoc managed scheduled notifications must not use a static runtime token.')
    return staticToken
  }
  const audience = setting(config, ['hzy.tenantRuntime.audience'], ['HZY_DATA_RUNTIME_AUDIENCE', 'HZY_TENANT_RUNTIME_AUDIENCE']) || 'data-runtime'
  const [app, action] = scope.split(/\.(.+)/).filter(Boolean)
  return await requestServiceAccessToken({ audience, scope: app && action ? `${audience}:${app}:${action}` : scope })
}
export async function callAltocReceivableRuntime<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireAltocReceivableRuntimeBinding()
  const response = await $fetch<{ code?: number, data?: T, message?: string }>(new URL(path, binding.endpoint.endsWith('/') ? binding.endpoint : `${binding.endpoint}/`).toString(), {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${await token(config, 'altoc.write')}`,
      'content-type': 'application/json',
      'x-hzy-tenant': binding.tenant,
      'x-hzy-deployment': binding.deployment
    },
    body,
    timeout: 10000
  })
  if (response.code !== undefined && response.code !== 0) throw new Error(response.message || 'Altoc runtime returned an error.')
  return response.data as T
}

export async function callAltocReceivableDueRuntime<T>(path: AltocReceivableDueRuntimePath, body: Record<string, unknown>): Promise<T> {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const binding = requireAltocReceivableDueRuntimeBinding()
  const url = new URL(path, binding.endpoint.endsWith('/') ? binding.endpoint : `${binding.endpoint}/`)
  const bearerToken = await token(config, altocReceivableDueWorkerScope)
  const signedAt = String(Date.now())
  const canonical = ['POST', url.pathname + url.search, altocReceivableDueWorkerActor, '', signedAt, altocReceivableDueWorkerPurpose].join('\n')
  const signature = createHmac('sha256', bearerToken).update(canonical).digest('base64url')
  const response = await $fetch<{ code?: number, data?: T, message?: string }>(url.toString(), {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${bearerToken}`,
      'content-type': 'application/json',
      'x-hzy-tenant': binding.tenant,
      'x-hzy-deployment': binding.deployment,
      'x-hzy-actor-uid': altocReceivableDueWorkerActor,
      'x-hzy-actor-signed-at': signedAt,
      'x-hzy-actor-purpose': altocReceivableDueWorkerPurpose,
      'x-hzy-actor-signature': signature
    }, body, timeout: 10000
  })
  if (response.code !== undefined && response.code !== 0) throw new Error(response.message || 'Altoc runtime returned an error.')
  return response.data as T
}
