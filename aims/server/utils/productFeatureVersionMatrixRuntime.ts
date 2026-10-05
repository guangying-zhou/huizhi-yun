import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productFeatureVersionMatrixInput } from './productFeatureVersionMatrixInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductFeatureVersionMatrix(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '只支持读取功能版本矩阵' })
  const code = getRouterParam(event, 'productCode') || ''
  const input = productFeatureVersionMatrixInput(getQuery(event))
  if (!crossDependencyProductCode(code) || !input) throw createError({ statusCode: 400, message: '产品、版本或分页无效' })
  const feature = await requireProductPermission(event, code, 'product_features', 'view')
  const version = await requireProductPermission(event, code, 'product_versions', 'view')
  if (![feature, version].every(facts => facts.product_code === code) || !(['actor_uid', 'revision', 'status', 'is_member', 'is_manager'] as const).every(key => feature[key] === version[key])) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
  const expires = Date.now() + 15000
  const result = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/features:version-matrix`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-features:read', query: { current_user: feature.actor_uid },
    body: { input, authorization: { resource: 'product_features', action: 'view', facts: feature, expires_at: expires }, version_authorization: { resource: 'product_versions', action: 'view', facts: version, expires_at: expires } }
  })
  if (!result.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  return result.data
}
