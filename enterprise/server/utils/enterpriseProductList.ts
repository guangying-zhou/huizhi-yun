import { createError, getQuery, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { compileFoundationProductScope } from '@hzy/foundation/server/utils/scopeEvaluator'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { productGlobalOnboardDecision } from '../../../aims/server/utils/productGlobalAuthorizationCore'
import { productListInput } from '../../../aims/server/utils/productListInput'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'

export async function enterpriseProductList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const input = productListInput(getQuery(event))
  if (!input) throw createError({ statusCode: 400, message: '产品筛选参数无效' })
  await prepareEnterpriseRuntime(event, 'aims.product-list')
  const [aims, assets, onboard] = await Promise.all([
    loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'products', action: 'view' }),
    loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'products', action: 'view' }),
    input.tree ? loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'products', action: 'onboard' }) : undefined
  ])
  const scope = compileFoundationProductScope({ grants: aims.grants, required: { appCode: 'aims', resourceCode: 'products', action: 'view' }, policyOf: () => aims.actionPolicy }, user.uid)
  if (!scope) throw createError({ statusCode: 503, message: '产品授权范围过大或格式不支持，请检查授权配置' })
  // An empty Assets grant hides current master data, while the independently
  // authorized Aims workspace can remain visible by its stable code.
  const assetsScope = assetsObjectScopeFromScopedAuthorization(assets, 'products', 'view')
  const expiresAt = enterpriseRuntimePermitExpiresAt()
  return callEnterpriseRuntime(event, 'aims.product-list', {
    tenant: user.tenant, deployment: user.deployment, input,
    authorization: {
      actor_uid: user.uid, resource: 'products', action: 'view', expires_at: expiresAt,
      can_onboard: onboard ? productGlobalOnboardDecision(onboard.grants, onboard.actionPolicy).allowed : false,
      ...scope
    },
    assets_authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'products', action: 'view', expiresAt, scope: assetsObjectScopeQuery(assetsScope)
    }
  })
}
