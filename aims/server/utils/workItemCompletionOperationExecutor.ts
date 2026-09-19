import { createError } from 'h3'
import { buildServiceCommandEnvelope, validateServiceCommandReceipt, classifyServiceOperationFailure, extractServiceOperationStatus, resolveServiceOperationConflictDisposition } from '@hzy/foundation/server/utils/serviceOperation'
import { hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { ClaimedDeliveryOperation, RuntimeRow, ServiceTicketDeliveryOperationIO } from './serviceTicketDeliveryOperationExecutor'

function validCommand(c: RuntimeRow) {
  const form = c.formData as RuntimeRow | undefined
  const context = c.bizContext as RuntimeRow | undefined
  return Object.keys(c).length === 10 && ['completionRequestId', 'workItemId', 'projectId'].every(key => Number.isSafeInteger(c[key]) && Number(c[key]) > 0)
    && ['workItemKey', 'actorUid', 'bizTitle'].every(key => typeof c[key] === 'string' && String(c[key]).trim())
    && typeof c.snapshotSha256 === 'string' && /^[a-f0-9]{64}$/.test(c.snapshotSha256)
    && c.idempotencyKey === `aims:work-item-completion:${c.completionRequestId}:workflow-submit:v1`
    && form && !Array.isArray(form) && Object.keys(form).length === 4 && ['completionRequestId', 'workItemId', 'projectId', 'snapshotSha256'].every(key => form[key] === c[key])
    && context && !Array.isArray(context) && Object.keys(context).length === 1 && context.project_id === c.projectId
}

export async function executeClaimedWorkItemCompletionOperation(operation: ClaimedDeliveryOperation, io: ServiceTicketDeliveryOperationIO) {
  const key = operation.operationKey
  if (!key || !operation.operationId || !Number.isSafeInteger(Number(operation.fencingToken)) || Number(operation.fencingToken) < 1) throw createError({ statusCode: 409, message: '完成审批操作租约无效' })
  let receipt
  let instance: RuntimeRow
  try {
    const c = operation.command
    if (operation.sourceApp !== 'aims' || operation.targetApp !== 'workflow' || operation.operationCode !== 'aims.work-item.completion.workflow-submit.v1' || operation.requiredCapability !== 'workflow:work-item-complete:create' || operation.commandSchemaVersion !== 'v1' || operation.idempotencyKey !== key || !operation.tenantCode || !operation.deploymentCode || !c || !validCommand(c) || c.idempotencyKey !== key || operation.originalActorUid !== c.actorUid || await hashServiceCommandPayload(c) !== operation.commandSha256) throw createError({ statusCode: 409, message: '完成审批冻结命令无效' })
    if (!io.callWorkflowWorkItemCompletion) throw createError({ statusCode: 503, message: '完成审批投递通道暂不可用' })
    const response = await io.callWorkflowWorkItemCompletion(buildServiceCommandEnvelope(operation), operation)
    receipt = validateServiceCommandReceipt(operation, response, { targetBizType: 'work_item_completion_workflow', targetBizCode: `completion-request:${c.completionRequestId}` })
    const value = response.result as RuntimeRow | undefined
    instance = value?.instance as RuntimeRow
    if (!instance || !Number.isSafeInteger(Number(instance.instance_id)) || Number(instance.instance_id) < 1 || typeof instance.instance_no !== 'string' || !instance.instance_no) throw createError({ statusCode: 409, message: '完成审批回执缺少实例绑定' })
  } catch (error) {
    const failure = classifyServiceOperationFailure(error, extractServiceOperationStatus(error) === 409 ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) } : {})
    const checkpoint = await io.callRuntime<RuntimeRow>(`/v1/aims/integration-operations/${encodeURIComponent(key)}:fail`, {
      operationId: operation.operationId, fencingToken: operation.fencingToken, httpStatus: failure.statusCode || 0,
      timedOut: failure.timedOut, networkError: failure.networkError, deliveryUncertain: failure.timedOut || failure.networkError,
      errorCode: failure.code, errorSummary: failure.summary, ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
    })
    return { synced: false, pending: true, operation: checkpoint }
  }
  try {
    const checkpoint = await io.callRuntime<RuntimeRow>(`/v1/aims/integration-operations/${encodeURIComponent(key)}:succeed`, {
      operationId: operation.operationId, fencingToken: operation.fencingToken, httpStatus: 200,
      targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
      receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
      receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode,
      responseSummarySha256: receipt.responseSummarySha256,
      workflowInstanceId: instance.instance_id, workflowInstanceNo: instance.instance_no
    })
    return { synced: true, pending: false, operation: checkpoint }
  } catch {
    return { synced: false, pending: true, operation: null, errorCode: 'integration_checkpoint_unavailable' }
  }
}
