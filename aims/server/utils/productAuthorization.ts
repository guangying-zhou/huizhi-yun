import { createError, type H3Event } from 'h3'
import { evaluateFoundationProductAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { productManifestResources } from '../../app/config/permissions'
import { requireAimsSessionUid } from './authIdentity'
import { productAuthorizationObject, type ProductAuthorizationFacts } from './productAuthorizationCore'

export async function checkProductPermission(event: H3Event, productCode: string, resourceCode: string, action: string) {
  const resource = productManifestResources.find(item => item.code === resourceCode)
  if (!resource?.actions.includes(action)) {
    throw createError({ statusCode: 403, message: '未声明的产品权限动作' })
  }
  const uid = await requireAimsSessionUid(event)
  const response = await maybeCallTenantRuntime<{ code: number, data: ProductAuthorizationFacts }>(event,
    `/v1/aims/internal/products/${encodeURIComponent(productCode)}/authorization-object`, {
      appCode: 'aims', scope: 'aims.read aims:products:authorization-object', method: 'GET',
      query: { current_user: uid }
    })
  if (!response.handled || response.data?.code !== 0 || !response.data.data) {
    throw createError({ statusCode: 503, message: '产品授权数据暂不可用' })
  }
  const object = productAuthorizationObject(response.data.data, productCode, uid)
  if (!object) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const authorization = await loadScopedAuthorizationFromConsoleRuntime(event, uid, 'aims', {
    resourceCode, action, object
  })
  const decision = evaluateFoundationProductAuthorization({ grants: authorization.grants, required: { appCode: 'aims', resourceCode, action }, object, policyOf: () => authorization.actionPolicy })
  return { allowed: decision.allowed, facts: response.data.data }
}

export async function requireProductPermission(event: H3Event, productCode: string, resourceCode: string, action: string) {
  const access = await checkProductPermission(event, productCode, resourceCode, action)
  if (!access.allowed) {
    const visible = action === 'view' ? false : (await checkProductPermission(event, productCode, 'products', 'view')).allowed
    throw createError({ statusCode: visible ? 403 : 404, message: visible ? '没有该产品操作权限' : '产品不存在或不可见' })
  }
  return access.facts
}
