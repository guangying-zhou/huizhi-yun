import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { requireProductPermission } from '../../../aims/server/utils/productAuthorization'
import { hasProductControlCharacter } from '../../../aims/server/utils/productWorkspaceInput'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'

export async function enterpriseProductWorkspace(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const productCode = getRouterParam(event, 'productCode') || ''
  if (!productCode || productCode !== productCode.trim() || !productCode.isWellFormed() || [...productCode].length > 64 || productCode.includes('/') || hasProductControlCharacter(productCode) || Object.keys(getQuery(event)).length) {
    throw createError({ statusCode: 400, message: '产品标识或查询参数无效' })
  }
  const source = await enterpriseProductAuthorizationSource(event)
  const facts = await requireProductPermission(event, productCode, 'products', 'view', source)
  const assets = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'products', action: 'view' })
  const scope = assetsObjectScopeFromScopedAuthorization(assets, 'products', 'view')
  const expiresAt = enterpriseRuntimePermitExpiresAt()
  return callEnterpriseRuntime(event, 'aims.product-workspace-view', {
    productCode, tenant: user.tenant, deployment: user.deployment,
    authorization: { resource: 'products', action: 'view', facts, expires_at: expiresAt },
    assets_authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'products', action: 'view', expiresAt, scope: assetsObjectScopeQuery(scope)
    }
  })
}
