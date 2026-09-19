import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
}

type AimsDueNotificationPath
  = '/v1/aims/service/notifications:scan-due'
    | '/v1/aims/service/notifications:acknowledge'
    | '/v1/aims/service/notifications:acknowledge-closure'

// Unified scheduler calls reuse the signed wake's event: Foundation verifies the
// wake for this app, pins the Runtime endpoint it carries and the selected
// generation, and issues a service-client token with the route's exact scope.
async function callUnifiedScheduler<T>(event: H3Event, path: string, scope: string, generation: string, body: Record<string, unknown>) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims', scope, capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy',
    enterpriseScheduler: { generation }, method: 'POST', query: {}, body
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'Unified Aims scheduler Runtime is unavailable.' })
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Unified Aims scheduler call failed.' })
  }
  return runtime.data.data as T
}

export async function callAimsUnifiedMilestoneRollover<T>(event: H3Event, generation: string) {
  return await callUnifiedScheduler<T>(event, '/v1/enterprise/aims/milestones:rollover-due', 'aims:milestone-rollover:execute', generation, {})
}

// Due notifications keep the legacy closed bodies on their unified routes.
export async function callAimsUnifiedDueNotification<T>(event: H3Event, path: AimsDueNotificationPath, body: Record<string, unknown>, generation: string) {
  const action = /^\/v1\/aims\/service\/notifications:(scan-due|acknowledge|acknowledge-closure)$/.exec(path)?.[1]
  if (!action) throw new Error('Unified due notification route is not implemented.')
  return await callUnifiedScheduler<T>(event, `/v1/enterprise/aims/notifications:${action}`, 'aims:notifications-due:execute', generation, body)
}
