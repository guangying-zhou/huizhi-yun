import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'

export async function handleEnterpriseIPAssetsLinkProduct(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '知识产权关联不接受查询参数' })
  const user = await requireEnterpriseUser(event)
  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!/^[1-9][0-9]{0,18}$/.test(id)) throw createError({ statusCode: 400, message: '知识产权资产标识无效' })
  const idempotencyKey = getHeader(event, 'Idempotency-Key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 240) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const input = await readBody<Record<string, unknown>>(event)
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Number.isSafeInteger(input.product_asset_id) || Number(input.product_asset_id) < 1) {
    throw createError({ statusCode: 400, message: '目标产品无效' })
  }
  await prepareEnterpriseRuntime(event, 'assets.ip-assets-link-product')
  const permit = async (resourceCode: 'ip_assets' | 'products', action: 'edit' | 'view') => {
    const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode, action })
    const scope = assetsObjectScopeFromScopedAuthorization(snapshot, resourceCode, action)
    if (scope.access === 'none') throw createError({ statusCode: 403, message: '无关联对象访问权限', data: { code: 'person_permission_denied' } })
    return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: resourceCode, action, expiresAt: enterpriseRuntimePermitExpiresAt(), scope: assetsObjectScopeQuery(scope) }
  }
  const authorization = await permit('ip_assets', 'edit')
  const targetAuthorization = await permit('products', 'view')
  return callEnterpriseRuntime(event, 'assets.ip-assets-link-product', { id, input, authorization, targetAuthorization }, { idempotencyKey })
}
