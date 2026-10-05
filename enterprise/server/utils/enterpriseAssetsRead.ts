import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'

const operations = {
  dictionaries: 'assets.asset-dictionaries',
  list: 'assets.asset-items-list',
  view: 'assets.asset-items-view'
} as const

const listQueryKeys = new Set(['page', 'pageSize', 'category', 'search', 'status'])

export async function handleEnterpriseAssetsRead(event: H3Event, action: keyof typeof operations) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const rawQuery = getQuery(event)
  if (!Object.hasOwn(operations, action) || Object.entries(rawQuery).some(([key, value]) => !listQueryKeys.has(key) || typeof value !== 'string' || !value.trim() || value.length > 200)) {
    throw createError({ statusCode: 400, message: '资产读取参数无效' })
  }
  if (action !== 'list' && Object.keys(rawQuery).length) throw createError({ statusCode: 400, message: '该资产读取不接受筛选参数' })
  const id = action === 'view' ? String(getRouterParam(event, 'id') || '').trim() : ''
  if (action === 'view' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    throw createError({ statusCode: 400, message: '资产标识无效' })
  }
  await prepareEnterpriseRuntime(event, operations[action])
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'asset_items', action: 'view' })
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'asset_items', 'view')
  if (scope.access === 'none') throw createError({ statusCode: 403, message: '无资产台账查看权限', data: { code: 'person_permission_denied' } })
  return callEnterpriseRuntime(event, operations[action], {
    ...(id ? { id } : {}),
    ...(action === 'list' ? { query: Object.fromEntries(Object.entries(rawQuery).map(([key, value]) => [key, String(value).trim()])) } : {}),
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'asset_items', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt(),
      scope: assetsObjectScopeQuery(scope)
    }
  })
}
