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

export const isServiceTicketAimsOperation = (operation: ClaimedOpsKnowledgeOperation) =>
  text(operation.operationCode) === 'altoc.service-ticket.aims-work-item.v1'

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

export async function executeServiceTicketAimsOperation(
  operation: ClaimedOpsKnowledgeOperation,
  io: OpsKnowledgeOperationIO
) {
  const command = row(operation.command)
  try {
    if (
      text(operation.sourceApp) !== 'altoc'
      || text(operation.targetApp) !== 'aims'
      || text(operation.operationCode) !== 'altoc.service-ticket.aims-work-item.v1'
      || text(operation.requiredCapability) !== 'aims:service-ticket:work-item:create'
      || !text(command.ticketCode)
      || !text(command.projectCode)
      || !text(operation.originalActorUid)
    ) {
      throw createError({ statusCode: 409, message: 'Claimed service ticket Aims operation is invalid.' })
    }
    const response = await io.callService<Row>(
      'aims',
      'aims:service-ticket:work-item:create',
      `/api/v1/service/service-tickets/${encodeURIComponent(text(command.ticketCode))}/work-item/receive`,
      buildServiceCommandEnvelope(operation),
      text(operation.idempotencyKey),
      text(operation.originalActorUid)
    )
    if (text(response.targetBizType) !== 'work_item' || !text(response.targetBizCode)) {
      throw createError({ statusCode: 409, message: 'Aims work item receipt target is invalid.' })
    }
    const receipt = validateServiceCommandReceipt(operation, response, {
      targetBizType: 'work_item', targetBizCode: text(response.targetBizCode)
    })
    const checkpoint = await io.callRuntime<Row>(
      `/v1/altoc/service-tickets/${encodeURIComponent(text(command.ticketCode))}/aims-work-item:complete`,
      {
        operationKey: text(operation.operationKey), operationId: text(operation.operationId), fencingToken: operation.fencingToken,
        targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
        receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
        receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType,
        targetBizCode: receipt.targetBizCode, responseSummarySha256: receipt.responseSummarySha256
      }
    )
    return {
      succeeded: true, pending: false, receipt, checkpoint,
      workItemKey: receipt.targetBizCode, projectCode: text(command.projectCode)
    }
  } catch (error) {
    try {
      return { succeeded: false, pending: true, checkpoint: await checkpointFailure(operation, io, error) }
    } catch {
      return { succeeded: false, pending: true, errorCode: 'integration_checkpoint_unavailable' }
    }
  }
}
