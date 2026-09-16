import { createError, getHeader, readBody, setResponseStatus } from 'h3'
import { maybeCallFinanceDataRuntime } from '~~/server/utils/dataRuntime'
import { tryDispatchFinanceWorkflowOperation } from '~~/server/utils/altocFinanceSummaryOperation'

type RuntimeRow = Record<string, unknown>
type RuntimeEnvelope = { code?: number | string, data?: RuntimeRow, message?: string }

export default defineEventHandler(async (event) => {
  const actorUid = String(getHeader(event, 'x-hzy-actor-uid') || '').trim()
  if (!actorUid) throw createError({ statusCode: 403, message: 'Trusted Altoc actor delegation is required.' })
  const body = (await readBody<RuntimeRow>(event)) || {}
  const envelope = body.serviceCommand as RuntimeRow | undefined
  const frozenCommand = envelope?.command as RuntimeRow | undefined
  if (String(frozenCommand?.actorUid || '').trim() !== actorUid) {
    throw createError({ statusCode: 403, message: 'Delegated actor does not match the frozen invoice command.' })
  }
  const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope>(event, '/v1/finance/service/invoice-requests:create', {
    // 双 scope 是仓库既定模式（对照 altoc 各 handler 的 'altoc.write altoc:...'）：
    // data-runtime 网关层按粗 scope finance.write 收口（isFinanceMutation 一刀切，
    // hasScope 的蕴含规则不接受三段细 capability），业务层再验精细 capability。
    // 只带细 scope 会在网关层被 insufficient_scope 拒绝（B-025 端到端复验实测）。
    scope: 'finance.write finance:invoice-request:create', method: 'POST', body, serviceCommandActor: { uid: actorUid }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'Finance tenant-runtime is required for reliable invoice requests.' })
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Finance invoice receipt failed.' })
  }
  const receipt = runtime.data.data || {}
  const invoiceCode = String(receipt.targetBizCode || '').trim()
  const workflowOperationKey = invoiceCode ? `finance:invoice-request:${invoiceCode}:workflow-submit:v1` : ''
  const workflowDelivery = workflowOperationKey
    ? await tryDispatchFinanceWorkflowOperation(event, workflowOperationKey)
    : { synced: false, pending: true, errorCode: 'workflow_operation_identity_missing' }
  setResponseStatus(event, workflowDelivery.synced ? 200 : 202)
  return { code: 0, data: { ...receipt, workflowOperationKey, workflowDelivery } }
})
