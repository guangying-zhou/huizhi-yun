import { createError, defineEventHandler, getQuery, readBody, setHeader } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../../../../../assets/server/utils/assetsScopedAuthorizationCore'

// Batch product names for cross-domain rendering. The browser only chooses which
// codes to ask about; visibility stays with the Assets products:view scope, and
// codes outside it come back as unresolved rather than as names.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '产品名称解析不接受查询参数' })
  const body = await readBody<Record<string, unknown>>(event)
  const codes = body?.codes ?? body?.productCodes ?? body?.product_codes
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !['codes', 'productCodes', 'product_codes'].includes(key))) {
    throw createError({ statusCode: 400, message: '产品名称解析参数无效' })
  }
  if (!Array.isArray(codes) || !codes.length || codes.length > 200
    || codes.some(code => typeof code !== 'string' || !code || code !== code.trim() || [...code].length > 64)
    || new Set(codes as string[]).size !== codes.length) {
    throw createError({ statusCode: 400, message: '产品编码列表无效' })
  }
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'products', action: 'view' })
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'products', 'view')
  if (scope.access === 'none') throw createError({ statusCode: 403, message: '无产品目录查看权限' })
  return callEnterpriseRuntime(event, 'assets.product-directory-resolve', {
    query: { codes },
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'products', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt(),
      scope: assetsObjectScopeQuery(scope)
    }
  })
})
