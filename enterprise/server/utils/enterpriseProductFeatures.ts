import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'
import type { ProductCommandBridge } from '../../../aims/server/utils/productCommandBridge'

export async function enterpriseProductFeatureBridge(event: H3Event): Promise<ProductCommandBridge> {
  const user = await requireEnterpriseUser(event)
  const authorizationSource = await enterpriseProductAuthorizationSource(event)
  const operations = {
    'cycles': 'aims.feature-cycles',
    'list': 'aims.feature-list',
    'view': 'aims.feature-view',
    'create': 'aims.feature-create',
    'edit': 'aims.feature-edit',
    'delete': 'aims.feature-delete',
    'component-assign': 'aims.feature-component-assign',
    'lifecycle': 'aims.feature-lifecycle',
    'request-list': 'aims.feature-request-list',
    'request-link': 'aims.feature-request-link',
    'roadmap': 'aims.feature-roadmap',
    'unscheduled': 'aims.feature-unscheduled'
  } as const
  return { authorizationSource, async call(productCode, action, body, key) {
    if (!Object.hasOwn(operations, action)) throw createError({ statusCode: 503, message: '功能操作暂不可用' })
    return callEnterpriseRuntime(event, operations[action as keyof typeof operations], { ...body, productCode, tenant: user.tenant, deployment: user.deployment }, { idempotencyKey: key })
  } }
}
