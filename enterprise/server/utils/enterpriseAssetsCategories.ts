import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization } from '../../../assets/server/utils/assetsScopedAuthorizationCore'

export async function handleEnterpriseAssetsCategories(event: H3Event, action: 'list' | 'save') {
  const user = await requireEnterpriseUser(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'admin', action: 'admin' })
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'admin', 'admin')
  if (scope.access !== 'all') throw createError({ statusCode: 403, message: '需要 Assets 管理权限' })
  const authorization = {
    actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
    resource: 'admin', action: 'admin', expiresAt: enterpriseRuntimePermitExpiresAt(),
    scope: { current_user_assets_object_access: 'all' }
  }
  const query = getQuery(event)
  if (Object.entries(query).some(([key, value]) => !['scope', 'pageSize'].includes(key) || typeof value !== 'string')
    || (query.scope && query.scope !== 'product')) throw createError({ statusCode: 400, message: '仅支持产品线管理' })
  if (action === 'list') return callEnterpriseRuntime(event, 'assets.product-categories-admin', { query: { scope: 'product' }, authorization })
  if (action !== 'save' || Object.keys(query).length) throw createError({ statusCode: 400, message: '不支持的分类操作' })
  const key = getHeader(event, 'Idempotency-Key')?.trim()
  if (!key || key.length > 240) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const rawId = getRouterParam(event, 'id')
  const id = rawId === undefined ? 0 : Number(rawId)
  if (!Number.isSafeInteger(id) || (rawId !== undefined && id <= 0)) throw createError({ statusCode: 400, message: '产品线编号无效' })
  const input = await readBody(event)
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.scope !== 'product') throw createError({ statusCode: 400, message: '产品线内容无效' })
  return callEnterpriseRuntime(event, 'assets.product-categories-save', { id, input, authorization }, { idempotencyKey: key })
}
