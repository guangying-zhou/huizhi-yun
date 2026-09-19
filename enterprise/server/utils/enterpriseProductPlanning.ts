import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import type { ProductCommandBridge } from '../../../aims/server/utils/productCommandBridge'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'

const operations = {
  'execution-coordination': 'aims.version-execution-coordination',
  'acceptance-list': 'aims.version-acceptance-list',
  'acceptance-view': 'aims.version-acceptance-view',
  'release-list': 'aims.version-release-list',
  'release-view': 'aims.version-release-view',

  'accept': 'aims.version-accept',
  'publish': 'aims.version-publish',
  'preview': 'aims.version-acceptance-preview',
  'execution-project-authorization': 'aims.version-execution-project-authorization',
  'edit': 'aims.version-edit',
  'delete': 'aims.version-delete',
  'transition': 'aims.version-transition',
  'reopen': 'aims.version-reopen',
  'archive': 'aims.version-archive',
  'plan': 'aims.version-plan',
  'plan-items': 'aims.version-plan-items',
  'list': 'aims.version-list',
  'view': 'aims.version-view',
  'create': 'aims.version-create',
  'plan-edit': 'aims.version-plan-edit',
  'plan-item-create': 'aims.version-plan-item-create',
  'plan-item-edit': 'aims.version-plan-item-edit',
  'plan-item-delete': 'aims.version-plan-item-delete',
  'plan-confirm': 'aims.version-plan-confirm'
} as const

export async function enterpriseProductPlanningBridge(event: H3Event): Promise<ProductCommandBridge> {
  const user = await requireEnterpriseUser(event)
  const authorizationSource = await enterpriseProductAuthorizationSource(event)
  return {
    authorizationSource,
    async call(productCode, action, body, idempotencyKey) {
      if (!Object.hasOwn(operations, action)) throw createError({ statusCode: 503, message: '版本操作暂不可用' })
      return callEnterpriseRuntime(event, operations[action as keyof typeof operations], {
        ...body, productCode, tenant: user.tenant, deployment: user.deployment
      }, { idempotencyKey })
    }
  }
}
