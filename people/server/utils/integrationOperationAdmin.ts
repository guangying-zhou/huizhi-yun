import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { hasTenantGlobalIntegrationOperationGrant } from '@hzy/foundation/server/utils/integrationOperationAdminAuthorization'
import { getRequestUid } from '~~/server/utils/authIdentity'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
}

// Browser administration is intentionally tenant-global. The runtime still
// limits the source-side family, so this does not widen Directory/Assets
// execution authority or let a browser select a command payload.
export async function callPeopleIntegrationOperationAdmin<T>(
  event: H3Event,
  path: string,
  action: 'view' | 'replay',
  options: { query?: Record<string, unknown>, body?: Record<string, unknown> } = {}
) {
  const uid = getRequestUid(event)
  const scoped = uid
    ? await loadScopedAuthorizationFromConsoleRuntime(event, uid, 'people', {
        resourceCode: 'integration_operations', action
      })
    : null
  if (!hasTenantGlobalIntegrationOperationGrant(scoped?.grants, { appCode: 'people', action })) {
    throw createError({ statusCode: 403, message: '跨应用操作管理要求租户全局授权' })
  }
  const method = action === 'view' ? 'GET' : 'POST'
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'people',
    scope: `${method === 'GET' ? 'people.read' : 'people.write'} people:integration_operations:${action}`,
    method,
    query: options.query,
    body: options.body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is required for integration operation administration.' })
  }
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') {
    throw createError({ statusCode: 502, message: runtime.data.message || 'People integration operation administration failed.' })
  }
  if (runtime.data.data === undefined) {
    throw createError({ statusCode: 502, message: 'People integration operation administration returned no data.' })
  }
  return runtime.data.data as T
}
