import { createError, getQuery, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductCostRulesProjectPermission } from './productCostRulesAuthorization'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductCostRulesStatus(event: H3Event, projectId: string, requestId: string) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '查询规则提交状态须使用 GET' })
  const query = getQuery(event)
  if (Object.keys(query).length !== 1 || typeof query.projectCode !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)
    || requestId === '00000000-0000-0000-0000-000000000000') throw createError({ statusCode: 400, message: '规则请求标识无效' })
  const permit = await requireProductCostRulesProjectPermission(event, projectId, query.projectCode)
  const response = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, '/v1/aims/internal/product-cost-rules:status', {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-cost-rules:status', query: { current_user: permit.actorUid },
    body: { requestId, authorization: { ...permit, purpose: 'product_cost_rules_status', expiresAt: Date.now() + 15000 } }
  })
  if (!response.handled) throw createError({ statusCode: 503, message: '规则状态查询暂不可用' })
  if (response.data.code !== 0) throw runtimeEnvelopeError(response.data)
  const data = response.data.data
  const statuses = ['pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'cancelled', 'failed_permanent', 'dead_letter']
  if (!data || data.requestId !== requestId || data.projectCode !== permit.projectCode
    || typeof data.status !== 'string' || !statuses.includes(data.status)
    || data.synced !== (data.status === 'succeeded')
    || data.pending !== ['pending', 'processing', 'retry_wait', 'partial_unknown'].includes(data.status)) {
    throw createError({ statusCode: 503, message: '规则状态响应不一致' })
  }
  return { code: 0, data: { requestId, projectCode: permit.projectCode, status: data.status, synced: data.synced, pending: data.pending } }
}
