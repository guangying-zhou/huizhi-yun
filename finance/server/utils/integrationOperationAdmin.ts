import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { hasTenantGlobalIntegrationOperationGrant } from '@hzy/foundation/server/utils/integrationOperationAdminAuthorization'
import { getRequestUid } from './authIdentity'

export async function callFinanceIntegrationOperationAdmin<T>(
  event: H3Event,
  path: string,
  action: 'view' | 'replay',
  options: { query?: Record<string, unknown>, body?: Record<string, unknown> } = {}
) {
  const uid = getRequestUid(event)
  const scoped = uid
    ? await loadScopedAuthorizationFromConsoleRuntime(event, uid, 'finance', {
        resourceCode: 'integration_operations', action
      })
    : null
  if (!hasTenantGlobalIntegrationOperationGrant(scoped?.grants, { appCode: 'finance', action })) {
    throw createError({ statusCode: 403, message: '跨应用操作管理要求租户全局授权' })
  }
  const method = action === 'view' ? 'GET' : 'POST'
  const runtime = await maybeCallTenantRuntime<T>(event, path, {
    appCode: 'finance',
    scope: `${method === 'GET' ? 'finance.read' : 'finance.write'} finance:integration_operations:${action}`,
    method,
    query: options.query,
    body: options.body
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'Finance tenant-runtime is required for integration operation administration.' })
  return runtime.data
}
