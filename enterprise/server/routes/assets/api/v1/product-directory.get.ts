import { createError, defineEventHandler, getQuery, setHeader } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../../../../assets/server/utils/assetsScopedAuthorizationCore'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const query = getQuery(event)
  const allowed = new Set(['page', 'pageSize', 'keyword', 'productCode', 'productLine', 'watermark'])
  if (Object.keys(query).some(key => !allowed.has(key) || typeof query[key] !== 'string')) {
    throw createError({ statusCode: 400, message: '产品目录筛选参数无效' })
  }
  const page = Number(query.page || 1)
  const pageSize = Number(query.pageSize || 50)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw createError({ statusCode: 400, message: '产品目录分页参数无效' })
  }
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'products', action: 'view' })
  // Product masters have no department dimension; constrained department
  // grants remain constrained and the owning Runtime domain rejects them.
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'products', 'view')
  if (scope.access === 'none') throw createError({ statusCode: 403, message: '无产品目录查看权限' })
  return callEnterpriseRuntime(event, 'assets.product-directory', {
    query: { ...query, page, pageSize },
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'products', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt(),
      scope: assetsObjectScopeQuery(scope)
    }
  })
})
