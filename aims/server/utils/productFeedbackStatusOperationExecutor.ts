import { createError } from 'h3'
import { buildServiceCommandEnvelope, validateServiceCommandReceipt, classifyServiceOperationFailure, extractServiceOperationStatus, resolveServiceOperationConflictDisposition } from '@hzy/foundation/server/utils/serviceOperation'
import { hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { ClaimedDeliveryOperation, RuntimeRow, ServiceTicketDeliveryOperationIO } from './serviceTicketDeliveryOperationExecutor'

export interface ProductFeedbackStatusOperationIO extends ServiceTicketDeliveryOperationIO {
  callAltocProductFeedbackStatus: (envelope: RuntimeRow, operation: ClaimedDeliveryOperation) => Promise<RuntimeRow>
}

export async function executeClaimedProductFeedbackStatusOperation(operation: ClaimedDeliveryOperation, io: ServiceTicketDeliveryOperationIO) {
  const key = operation.operationKey
  if (!key || !operation.operationId || !Number.isSafeInteger(Number(operation.fencingToken)) || Number(operation.fencingToken) < 1) throw createError({ statusCode: 409, message: '反馈状态回流操作租约无效' })
  let receipt
  try {
    const c = operation.command
    if (operation.sourceApp !== 'aims' || operation.targetApp !== 'altoc' || operation.operationCode !== 'aims.altoc.product-feedback.update-status.v1' || operation.requiredCapability !== 'altoc:product-feedback:update-status' || operation.commandSchemaVersion !== 'product-feedback-status.v1' || operation.idempotencyKey !== key || !operation.tenantCode || !operation.deploymentCode || !c || Object.keys(c).length !== 6 || typeof c.productCode !== 'string' || !c.productCode || typeof c.ticketCode !== 'string' || !c.ticketCode || typeof c.requestBizId !== 'string' || typeof c.canonicalRequestBizId !== 'string' || !Number.isSafeInteger(c.sourceRevision) || Number(c.sourceRevision) < 1 || !['submitted', 'evaluating', 'accepted', 'deferred', 'rejected', 'merged'].includes(String(c.decisionStatus)) || (c.decisionStatus === 'merged') !== (c.requestBizId !== c.canonicalRequestBizId) || await hashServiceCommandPayload(c) !== operation.commandSha256) throw createError({ statusCode: 409, message: '反馈状态回流冻结命令无效' })
    if (!io.callAltocProductFeedbackStatus) throw createError({ statusCode: 503, message: '反馈状态回流投递通道暂不可用' })
    const response = await io.callAltocProductFeedbackStatus(buildServiceCommandEnvelope(operation), operation)
    receipt = validateServiceCommandReceipt(operation, response, { targetBizType: 'product_feedback', targetBizCode: c.requestBizId })
    const value = response.result as RuntimeRow | undefined
    if (!value || value.requestBizId !== c.requestBizId || value.sourceRevision !== c.sourceRevision || typeof value.applied !== 'boolean') throw createError({ statusCode: 409, message: '反馈状态回流回执结果不一致' })
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
      responseSummarySha256: receipt.responseSummarySha256
    })
    return { synced: true, pending: false, operation: checkpoint }
  } catch {
    return { synced: false, pending: true, operation: null, errorCode: 'integration_checkpoint_unavailable' }
  }
}
