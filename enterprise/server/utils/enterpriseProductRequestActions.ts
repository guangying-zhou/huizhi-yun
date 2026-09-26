import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import type { ProductCommandBridge } from '../../../aims/server/utils/productCommandBridge'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'

const operations = {
  'create': 'aims.product-request-create', 'merge': 'aims.request-merge',
  'edit': 'aims.request-edit', 'decide': 'aims.request-decide',
  'source-list': 'aims.request-source-list', 'source-create': 'aims.request-source-create', 'source-delete': 'aims.request-source-delete'
} as const
export async function enterpriseProductRequestActions(event: H3Event): Promise<ProductCommandBridge> {
  const user = await requireEnterpriseUser(event)
  const authorizationSource = await enterpriseProductAuthorizationSource(event)
  return { authorizationSource, async call(productCode, action, body, idempotencyKey) {
    if (!Object.hasOwn(operations, action)) throw createError({ statusCode: 503, message: '需求操作暂不可用' })
    return callEnterpriseRuntime(event, operations[action as keyof typeof operations], { ...body, productCode, tenant: user.tenant, deployment: user.deployment }, { idempotencyKey })
  } }
}
