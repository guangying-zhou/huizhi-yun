import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
}

type AssetsDueNotificationPath
  = '/v1/assets/service/notifications:scan-due'
    | '/v1/assets/service/notifications:acknowledge'
    | '/v1/assets/service/notifications:acknowledge-closure'

// Unified Assets due notifications reuse the signed wake's event: Foundation
// verifies the wake for Assets, pins the Runtime endpoint it carries and the
// selected generation, and issues a service-client token with the exact scope.
// The legacy closed request bodies are kept on the unified routes.
export async function callAssetsUnifiedDueNotification<T>(event: H3Event, path: AssetsDueNotificationPath, body: Record<string, unknown>, generation: string) {
  const action = /^\/v1\/assets\/service\/notifications:(scan-due|acknowledge|acknowledge-closure)$/.exec(path)?.[1]
  if (!action) throw new Error('Unified Assets due notification route is not implemented.')
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, `/v1/enterprise/assets/notifications:${action}`, {
    appCode: 'assets', scope: 'assets:notifications-due:execute', capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy',
    enterpriseScheduler: { generation }, method: 'POST', query: {}, body
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'Unified Assets scheduler Runtime is unavailable.' })
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Unified Assets due notification call failed.' })
  }
  return runtime.data.data as T
}
