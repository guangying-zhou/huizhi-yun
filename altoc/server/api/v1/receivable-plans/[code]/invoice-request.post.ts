import { createError, getHeader, getRouterParam, readBody, setResponseStatus } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'
import { createRequestOpsKnowledgeOperationIO, claimOpsKnowledgeOperation } from '~~/server/utils/serviceTicketOpsKnowledgeOperation'
import { executeReceivableInvoiceOperation } from '~~/server/utils/receivableInvoiceOperation'

type Row = Record<string, unknown>
interface RuntimeEnvelope<T> { code?: number | string, data?: T, message?: string }
interface PreparedInvoiceRequest {
  receivablePlan?: Row
  invoiceRequest?: Row
  idempotencyKey?: string
  operation?: { operationId?: string, operationKey?: string, status?: string }
}
const text = (value: unknown) => String(value || '').trim()
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

export default defineEventHandler(async (event) => {
  const receivablePlanCode = text(getRouterParam(event, 'code'))
  if (!receivablePlanCode) throw createError({ statusCode: 400, message: 'receivablePlanCode is required' })

  await requirePermission(event, 'receivable', 'edit')
  const actorUid = getRequestUid(event)
  if (!actorUid) throw createError({ statusCode: 401, message: 'Verified actor is required.' })
  const body = row(await readBody(event).catch(() => ({})))
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'receivable', 'edit')
  // 不再由 BFF 兜底一个每计划固定的幂等键：那样一条回款计划终身只能发出一次
  // 开票申请，分次开票和「金额变化后重发」都会撞 409（走查 ISSUE-B-006）。
  // 调用方显式传 Idempotency-Key 时仍然以它为准；否则交给 runtime 在事务内按
  // 已终结的 operation 数推导序号——在途的沿用同一序号，重复点击仍是幂等重放。
  const requestedKey = text(getHeader(event, 'idempotency-key'))
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<PreparedInvoiceRequest>>(
    event,
    `/v1/altoc/service/receivable-plans/${encodeURIComponent(receivablePlanCode)}/invoice-request:prepare`,
    {
      appCode: 'altoc', scope: 'altoc.write altoc:receivable:edit', method: 'POST', query: dataAccessQuery,
      body: {
        ...body,
        operatorUid: actorUid, operator_uid: actorUid, current_user: actorUid,
        ...(requestedKey ? { idempotencyKey: requestedKey } : {})
      }
    }
  )
  if (!runtime.handled || (runtime.data.code !== undefined && String(runtime.data.code) !== '0') || !runtime.data.data) {
    throw createError({ statusCode: 503, message: runtime.handled ? runtime.data.message || 'Altoc invoice operation freeze failed.' : 'Altoc tenant-runtime is required.' })
  }
  const prepared = runtime.data.data
  const frozenKey = text(prepared.operation?.operationKey)
  if (!frozenKey) throw createError({ statusCode: 502, message: 'Altoc invoice operation freeze did not return an operation key.' })
  // 调用方钉了键就必须原样冻结，避免 runtime 静默改写调用方的幂等身份。
  if (requestedKey && frozenKey !== requestedKey) {
    throw createError({ statusCode: 409, message: 'Frozen invoice operation identity mismatch.' })
  }
  const operationKey = frozenKey

  const io = createRequestOpsKnowledgeOperationIO(event, dataAccessQuery)
  const claimed = await claimOpsKnowledgeOperation(io, frozenKey)
  const delivery = claimed
    ? await executeReceivableInvoiceOperation(claimed, io)
    : { succeeded: prepared.operation?.status === 'succeeded', pending: prepared.operation?.status !== 'succeeded' }
  setResponseStatus(event, delivery.succeeded ? 200 : 202)

  // 投递结果必须是响应体里的一等字段。executeReceivableInvoiceOperation 会把
  // 包括 Console 401/403 在内的全部异常收敛成 { succeeded:false, pending:true }，
  // 若响应只有 code:0，调用方无法区分「开票申请已送达 Finance」和「什么都没发生」
  // ——生产上前端正是据此弹绿色成功（走查 ISSUE-B-001）。
  return {
    code: 0, message: 'ok',
    data: {
      receivablePlan: prepared.receivablePlan,
      invoiceRequest: prepared.invoiceRequest,
      operation: prepared.operation,
      delivery,
      delivered: delivery.succeeded === true,
      deliveryPending: delivery.succeeded !== true,
      invoiceRequestCode: 'invoiceRequestCode' in delivery ? delivery.invoiceRequestCode : null,
      workflowOperationKey: 'workflowOperationKey' in delivery ? delivery.workflowOperationKey : null,
      idempotencyKey: operationKey
    }
  }
})
