import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'
import type { ProductCommandBridge } from '../../../aims/server/utils/productCommandBridge'

const operations = { 'detail': 'aims.handoff-detail', 'projects': 'aims.handoff-projects', 'requirements': 'aims.handoff-requirements', 'project-authorization': 'aims.handoff-project-authorization', 'create': 'aims.handoff-create' } as const
export async function enterpriseProductHandoffBridge(event: H3Event): Promise<ProductCommandBridge> {
  const user = await requireEnterpriseUser(event), authorizationSource = await enterpriseProductAuthorizationSource(event)
  return { authorizationSource, async call(productCode, action, body, key) {
    if (!Object.hasOwn(operations, action)) throw createError({ statusCode: 503, message: '项目承接操作未注册' })
    return callEnterpriseRuntime(event, operations[action as keyof typeof operations], { ...body, productCode, tenant: user.tenant, deployment: user.deployment }, { idempotencyKey: key })
  } }
}
