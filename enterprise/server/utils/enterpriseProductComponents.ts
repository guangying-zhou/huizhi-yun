import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { handleProductComponent } from '../../../aims/server/utils/productComponentRuntime'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'

export async function enterpriseProductComponents(event: H3Event, componentAction: 'list' | 'create' | 'edit' | 'move' | 'delete' = 'list') {
  const user = await requireEnterpriseUser(event)
  const authorizationSource = await enterpriseProductAuthorizationSource(event)
  return handleProductComponent(event, componentAction, {
    authorizationSource,
    async call(productCode, action, body, key) {
      const operations = { list: 'aims.component-list', create: 'aims.component-create', edit: 'aims.component-edit', move: 'aims.component-move', delete: 'aims.component-delete' } as const
      const operation = operations[action as keyof typeof operations]
      if (!operation) throw createError({ statusCode: 503, message: '模块操作暂不可用' })
      return callEnterpriseRuntime(event, operation, {
        ...body, productCode, tenant: user.tenant, deployment: user.deployment
      }, { idempotencyKey: key })
    }
  })
}
