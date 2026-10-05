import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { requireProductPermission } from '../../../aims/server/utils/productAuthorization'
import type { ProductAuthorizationFacts } from '../../../aims/server/utils/productAuthorizationCore'

export async function enterpriseProductAuthorizationSource(event: H3Event) {
  const user = await requireEnterpriseUser(event)
  const facts = new Map<string, Promise<ProductAuthorizationFacts>>()
  return {
    uid: user.uid,
    loadFacts(productCode: string) {
      let pending = facts.get(productCode)
      if (!pending) {
        pending = callEnterpriseRuntime<{ code: number, data: ProductAuthorizationFacts }>(event, 'aims.product-authorization', { productCode }).then((result) => {
          if (result.code !== 0 || !result.data) throw createError({ statusCode: 503, message: '产品授权数据暂不可用' })
          return result.data
        })
        facts.set(productCode, pending)
      }
      return pending
    }
  }
}

export async function requireEnterpriseProductPermission(event: H3Event, code: string, action: 'create' | 'view') {
  const user = await requireEnterpriseUser(event)
  const source = await enterpriseProductAuthorizationSource(event)
  const facts = await requireProductPermission(event, code, 'product_requests', action, source)
  return { user, authorization: { resource: 'product_requests', action, facts, expires_at: enterpriseRuntimePermitExpiresAt() } }
}
