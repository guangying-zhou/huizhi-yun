import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'

const operations = {
  list: 'assets.ip-assets-list',
  view: 'assets.ip-assets-view',
  products: 'assets.ip-assets-products'
} as const

const listQueryKeys = new Set(['page', 'pageSize', 'search', 'status'])

// Console derives the user-bound object scope; this BFF passes only that
// short-lived evidence to the independently authorized Runtime read operation.
export async function handleEnterpriseIPAssetsRead(event: H3Event, action: keyof typeof operations) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const rawQuery = getQuery(event)
  if (!Object.hasOwn(operations, action) || Object.entries(rawQuery).some(([key, value]) => !listQueryKeys.has(key) || typeof value !== 'string' || !value.trim() || value.length > 200)) {
    throw createError({ statusCode: 400, message: '知识产权资产读取参数无效' })
  }
  if (action !== 'list' && Object.keys(rawQuery).length) throw createError({ statusCode: 400, message: '该知识产权资产读取不接受筛选参数' })
  const id = action !== 'list' ? String(getRouterParam(event, 'id') || '').trim() : ''
  if (action !== 'list' && !/^[1-9][0-9]{0,18}$/.test(id)) {
    throw createError({ statusCode: 400, message: '知识产权资产标识无效' })
  }
  await prepareEnterpriseRuntime(event, operations[action])
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'ip_assets', action: 'view' })
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'ip_assets', 'view')
  if (scope.access === 'none') throw createError({ statusCode: 403, message: '无知识产权资产查看权限', data: { code: 'person_permission_denied' } })
  let targetAuthorization: Record<string, unknown> | undefined
  if (action === 'products') {
    const targetSnapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'products', action: 'view' })
    const targetScope = assetsObjectScopeFromScopedAuthorization(targetSnapshot, 'products', 'view')
    if (targetScope.access === 'none') throw createError({ statusCode: 403, message: '无关联产品查看权限', data: { code: 'person_permission_denied' } })
    targetAuthorization = {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'products', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt(),
      scope: assetsObjectScopeQuery(targetScope)
    }
  }
  return callEnterpriseRuntime(event, operations[action], {
    ...(id ? { id } : {}),
    ...(action === 'list' ? { query: Object.fromEntries(Object.entries(rawQuery).map(([key, value]) => [key, String(value).trim()])) } : {}),
    ...(targetAuthorization ? { targetAuthorization } : {}),
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'ip_assets', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt(),
      scope: assetsObjectScopeQuery(scope)
    }
  })
}
