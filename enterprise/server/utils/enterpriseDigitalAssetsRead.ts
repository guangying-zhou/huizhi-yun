import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'

const operations = {
  list: 'assets.digital-assets-list',
  view: 'assets.digital-assets-view'
} as const

const listQueryKeys = new Set(['page', 'pageSize', 'search', 'status'])

// The service capability is intentionally distinct from the user-facing
// digital_assets:view permission.  Console decides the latter and compiles a
// short-lived, subject-bound object scope before this BFF calls Runtime.
export async function handleEnterpriseDigitalAssetsRead(event: H3Event, action: keyof typeof operations) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const rawQuery = getQuery(event)
  if (!Object.hasOwn(operations, action) || Object.entries(rawQuery).some(([key, value]) => !listQueryKeys.has(key) || typeof value !== 'string' || !value.trim() || value.length > 200)) {
    throw createError({ statusCode: 400, message: '数字资产读取参数无效' })
  }
  if (action !== 'list' && Object.keys(rawQuery).length) throw createError({ statusCode: 400, message: '该数字资产读取不接受筛选参数' })
  const id = action === 'view' ? String(getRouterParam(event, 'id') || '').trim() : ''
  if (action === 'view' && !/^[1-9][0-9]{0,18}$/.test(id)) {
    throw createError({ statusCode: 400, message: '数字资产标识无效' })
  }
  await prepareEnterpriseRuntime(event, operations[action])
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'digital_assets', action: 'view' })
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'digital_assets', 'view')
  if (scope.access === 'none') throw createError({ statusCode: 403, message: '无数字资产查看权限', data: { code: 'person_permission_denied' } })
  return callEnterpriseRuntime(event, operations[action], {
    ...(id ? { id } : {}),
    ...(action === 'list' ? { query: Object.fromEntries(Object.entries(rawQuery).map(([key, value]) => [key, String(value).trim()])) } : {}),
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'digital_assets', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt(),
      scope: assetsObjectScopeQuery(scope)
    }
  })
}
