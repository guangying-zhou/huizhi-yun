import { createError, getQuery, getRouterParam, readBody, setHeader, setResponseStatus, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductCostRulesProjectPermission } from './productCostRulesAuthorization'
import { createRequestServiceTicketDeliveryOperationIO } from './serviceTicketDeliveryOperation'
import { executeClaimedProductCostRulesOperation } from './productCostRulesOperationExecutor'
import type { ClaimedDeliveryOperation } from './serviceTicketDeliveryOperationExecutor'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductCostRulesSave(event: H3Event, projectId = getRouterParam(event, 'id') || '') {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: '保存规则须使用 POST' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '不接受查询参数' })
  const input = await readBody<Record<string, unknown>>(event)
  const invalid = () => createError({ statusCode: 400, message: '分摊规则参数无效' })
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 6
    || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.requestId) || input.requestId === '00000000-0000-0000-0000-000000000000'
    || typeof input.projectCode !== 'string' || typeof input.periodMonth !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(input.periodMonth) || input.periodMonth.startsWith('0000')
    || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0 || Number(input.expectedRevision) >= Number.MAX_SAFE_INTEGER
    || typeof input.evidenceRef !== 'string' || !input.evidenceRef.isWellFormed() || !input.evidenceRef.trim() || /[\p{Cc}]/u.test(input.evidenceRef) || new TextEncoder().encode(input.evidenceRef).length > 500
    || !Array.isArray(input.shares) || input.shares.length > 10000) throw invalid()
  let total = 0
  const seen = new Set<string>()
  const shares = input.shares.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid()
    const item = row as Record<string, unknown>
    if (Object.keys(item).length !== 2 || typeof item.productCode !== 'string' || !item.productCode.isWellFormed()
      || !item.productCode || item.productCode !== item.productCode.trim() || [...item.productCode].length > 64 || /[/\\\p{Cc}]/u.test(item.productCode)
      || seen.has(item.productCode) || !Number.isSafeInteger(item.basisPoints) || Number(item.basisPoints) < 1 || Number(item.basisPoints) > 10000) throw invalid()
    total += Number(item.basisPoints)
    if (total > 10000) throw invalid()
    seen.add(item.productCode)
    return { productCode: item.productCode, basisPoints: Number(item.basisPoints) }
  })
  const permit = await requireProductCostRulesProjectPermission(event, projectId, input.projectCode)
  const command = { actorUid: permit.actorUid, projectCode: permit.projectCode, periodMonth: input.periodMonth,
    expectedRevision: Number(input.expectedRevision), evidenceRef: input.evidenceRef, shares }
  const frozen = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, '/v1/aims/internal/product-cost-rules:freeze', {
    appCode: 'aims', method: 'POST', scope: 'aims.write aims:product-cost-rules:freeze', query: { current_user: permit.actorUid },
    body: { requestId: input.requestId, command, authorization: { ...permit, purpose: 'product_cost_rules_freeze', expiresAt: Date.now() + 15000 } }
  })
  if (!frozen.handled) throw createError({ statusCode: 503, message: '规则保存服务暂不可用' })
  if (frozen.data.code !== 0) throw runtimeEnvelopeError(frozen.data)
  const key = `aims:product-cost-rules:${input.requestId}`
  if (frozen.data.data?.operationKey !== key || frozen.data.data.requestId !== input.requestId || frozen.data.data.projectCode !== permit.projectCode) {
    throw createError({ statusCode: 503, message: '规则保存响应不一致，请使用原请求标识重试' })
  }
  let synced = false
  try {
    const io = createRequestServiceTicketDeliveryOperationIO(event)
    const operation = await io.callRuntime<ClaimedDeliveryOperation | null>(`/v1/aims/integration-operations/${encodeURIComponent(key)}:claim`, {})
    if (operation && operation.operationKey === key && operation.command?.projectCode === permit.projectCode
      && operation.command.actorUid === permit.actorUid) {
      synced = (await executeClaimedProductCostRulesOperation(operation, io)).synced
    }
  } catch {
    // Freeze has committed. A wake failure must not encourage a new request ID.
  }
  if (!synced) setResponseStatus(event, 202)
  return { code: 0, data: { requestId: input.requestId, projectCode: permit.projectCode, synced, pending: !synced } }
}
