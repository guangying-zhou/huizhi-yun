import { createError, type H3Event } from 'h3'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from './assetsScopedAuthorizationCore'

// Console supplies the tenant-bound Directory tree after the caller verifies
// the signed actor. Never use service identity department claims.
export async function resolveProductAdoptionAuthorization(event: H3Event, actorUid: string) {
  const resolve = async (resourceCode: string, purpose: string) => {
    const snapshot = await loadSubjectScopedAuthorizationByService({ event, subjectUid: actorUid, purpose, resourceCode, action: 'view' })
    const scope = assetsObjectScopeFromScopedAuthorization(snapshot, resourceCode, 'view', snapshot.departmentCodes, snapshot.departmentTree)
    // reason 是稳定原因码：调用方据此把"原用户缺数据范围"与"服务身份或签名不对"
    // 分开呈现，后者不是最终用户能自助解决的问题，不应提示其去申请权限。
    if (scope.access === 'none') {
      throw createError({
        statusCode: 403,
        message: '无权查看产品采用涉及的交付资产或环境',
        data: { reason: 'assets_object_scope_denied', resourceCode }
      })
    }
    return { current_user: actorUid, ...assetsObjectScopeQuery(scope) }
  }
  const delivery = await resolve('deliveries', 'product_adoption_deliveries')
  const environment = await resolve('environments', 'product_adoption_environments')
  return { delivery, environment }
}
