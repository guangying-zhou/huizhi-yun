import { createError } from 'h3'
import {
  buildServiceCommandEnvelope,
  classifyServiceOperationFailure,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  validateServiceCommandReceipt
} from '@hzy/foundation/server/utils/serviceOperation'
import type { ClaimedOpsKnowledgeOperation, OpsKnowledgeOperationIO } from './serviceTicketOpsKnowledgeOperation'

type Row = Record<string, unknown>
const text = (value: unknown) => String(value || '').trim()
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

export const isProductFeedbackOperation = (operation: ClaimedOpsKnowledgeOperation) =>
  text(operation.operationCode) === 'altoc.aims.product-request.create-from-feedback.v1'

async function checkpointFailure(operation: ClaimedOpsKnowledgeOperation, io: OpsKnowledgeOperationIO, error: unknown) {
  const status = extractServiceOperationStatus(error)
  const failure = classifyServiceOperationFailure(error, status === 409
    ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) }
    : {})
  return await io.callRuntime<Row>(`/v1/altoc/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`, {
    operationId: text(operation.operationId), fencingToken: operation.fencingToken,
    httpStatus: failure.statusCode || 0, timedOut: failure.timedOut, networkError: failure.networkError,
    deliveryUncertain: failure.timedOut || failure.networkError,
    errorCode: failure.code, errorSummary: failure.summary,
    ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
  })
}

export async function executeProductFeedbackOperation(
  operation: ClaimedOpsKnowledgeOperation,
  io: OpsKnowledgeOperationIO
) {
  const command = row(operation.command)
  try {
    if (
      text(operation.sourceApp) !== 'altoc'
      || text(operation.targetApp) !== 'aims'
      || text(operation.operationCode) !== 'altoc.aims.product-request.create-from-feedback.v1'
      || text(operation.requiredCapability) !== 'aims:product-request:create-from-feedback'
      || !text(command.ticketCode)
      || !text(command.productCode)
      || !text(operation.originalActorUid)
      || command.actorUid !== operation.originalActorUid
      || operation.commandSchemaVersion !== 'product-feedback-create.v1'
      || command.action !== 'create'
      || Object.keys(command).length !== 7
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text(command.requestBizId))
    ) {
      throw createError({ statusCode: 409, message: 'Claimed product feedback operation is invalid.' })
    }
    if (!io.callProductFeedback) throw createError({ statusCode: 503, message: 'Signed feedback transport is unavailable.' })
    const response = await io.callProductFeedback(operation, buildServiceCommandEnvelope(operation))
    if (text(response.targetBizType) !== 'product_request' || text(response.targetBizCode) !== text(command.requestBizId)) {
      throw createError({ statusCode: 409, message: 'Aims product request receipt target is invalid.' })
    }
    const receipt = validateServiceCommandReceipt(operation, response, {
      targetBizType: 'product_request', targetBizCode: text(command.requestBizId)
    })
    let checkpoint: Row
    try {
      checkpoint = await io.callRuntime<Row>(
        `/v1/altoc/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`,
        {
          httpStatus: 200, operationKey: text(operation.operationKey), operationId: text(operation.operationId), fencingToken: operation.fencingToken,
          targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
          receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
          receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType,
          targetBizCode: receipt.targetBizCode, responseSummarySha256: receipt.responseSummarySha256
        }
      )
    } catch {
      return { succeeded: false, pending: true, errorCode: 'integration_checkpoint_unavailable' }
    }
    return {
      succeeded: true, pending: false, receipt, checkpoint,
      requestBizId: receipt.targetBizCode, productCode: text(command.productCode)
    }
  } catch (error) {
    try {
      return { succeeded: false, pending: true, checkpoint: await checkpointFailure(operation, io, error) }
    } catch {
      return { succeeded: false, pending: true, errorCode: 'integration_checkpoint_unavailable' }
    }
  }
}
