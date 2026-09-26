import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../../../../../../assets/server/utils/assetsScopedAuthorizationCore'
import { requireEnterpriseProductView } from '../../../../../../utils/enterpriseProductReadGate'
import { enterpriseProductAuthorizationSource } from '../../../../../../utils/enterpriseProductAuthorization'
import { requireProductPermission } from '../../../../../../../../aims/server/utils/productAuthorization'
import { hasProductControlCharacter } from '../../../../../../../../aims/server/utils/productWorkspaceInput'

// Product adoption spans delivery assets and environments. Both object scopes
// are compiled here for the signed-in user and sent as separate bound permits;
// the unified Runtime answers from one snapshot instead of the old signed
// cross-app command to the standalone Assets worker.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseProductView(event, 'products')
  const productCode = String(getRouterParam(event, 'productCode') || '')
  if (!productCode || productCode !== productCode.trim() || [...productCode].length > 64 || productCode.includes('/') || hasProductControlCharacter(productCode)) {
    throw createError({ statusCode: 400, message: '产品编码无效' })
  }
  const query = getQuery(event)
  if (Object.keys(query).some(key => !['page', 'pageSize'].includes(key) || typeof query[key] !== 'string')) {
    throw createError({ statusCode: 400, message: '产品采用分页参数无效' })
  }
  const page = Number(query.page || 1)
  const pageSize = Number(query.pageSize || 20)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw createError({ statusCode: 400, message: '产品采用分页参数无效' })
  }
  await requireProductPermission(event, productCode, 'products', 'view', await enterpriseProductAuthorizationSource(event))
  const expiresAt = enterpriseRuntimePermitExpiresAt()
  const permits: Record<string, unknown> = {}
  for (const [field, resourceCode] of [['deliveryAuthorization', 'deliveries'], ['environmentAuthorization', 'environments']] as const) {
    const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode, action: 'view' })
    const scope = assetsObjectScopeFromScopedAuthorization(snapshot, resourceCode, 'view')
    // A denied family is the user's own scope result, not a service failure.
    if (scope.access === 'none') throw createError({ statusCode: 403, data: { reason: 'assets_object_scope_denied', resourceCode }, message: '无权查看产品采用涉及的交付资产或环境' })
    permits[field] = {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: resourceCode, action: 'view', expiresAt, scope: assetsObjectScopeQuery(scope)
    }
  }
  return callEnterpriseRuntime(event, 'assets.product-adoption-read', {
    query: { productCode, page, pageSize },
    ...permits
  })
})
