import { createError, type H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

type ProductViewResource = 'products' | 'product_priorities'

export async function requireEnterpriseProductView(event: H3Event, resource: ProductViewResource) {
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, resource, 'view', authorization.actionPolicies?.[resource])) {
    throw createError({ statusCode: 403, message: '无产品查看权限' })
  }
  return user
}
