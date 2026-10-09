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

export function isReceivableInvoiceOperation(operation: ClaimedOpsKnowledgeOperation) {
  return text(operation.operationCode) === 'altoc.receivable.finance-invoice-request.v1'
}

function validate(operation: ClaimedOpsKnowledgeOperation) {
  const command = row(operation.command)
  if (
    text(operation.sourceApp) !== 'altoc'
    || text(operation.targetApp) !== 'finance'
    || text(operation.operationCode) !== 'altoc.receivable.finance-invoice-request.v1'
    || text(operation.requiredCapability) !== 'finance:invoice-request:create'
    || text(operation.idempotencyKey) !== text(operation.operationKey)
    || text(command.idempotencyKey) !== text(operation.operationKey)
    || !text(command.receivablePlanCode)
    || !text(command.actorUid)
    || text(row(command.invoiceRequest).receivablePlanCode) !== text(command.receivablePlanCode)
  ) {
    throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'Claimed Altoc invoice operation is invalid.' })
  }
  return command
}

async function fail(operation: ClaimedOpsKnowledgeOperation, io: OpsKnowledgeOperationIO, error: unknown) {
  const status = extractServiceOperationStatus(error)
  const failure = classifyServiceOperationFailure(error, status === 409 ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) } : {})
  return await io.callRuntime<Row>(`/v1/altoc/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`, {
    operationId: text(operation.operationId), fencingToken: operation.fencingToken,
    httpStatus: failure.statusCode || 0, timedOut: failure.timedOut, networkError: failure.networkError,
    deliveryUncertain: failure.timedOut || failure.networkError, errorCode: failure.code, errorSummary: failure.summary,
    ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
  })
}

export async function executeReceivableInvoiceOperation(operation: ClaimedOpsKnowledgeOperation, io: OpsKnowledgeOperationIO) {
  let command: Row
  try {
    command = validate(operation)
  } catch (error) {
    return { succeeded: false, pending: true, checkpoint: await fail(operation, io, error) }
  }
  try {
    const response = await io.callService<Row>(
      'finance', 'finance:invoice-request:create', '/api/v1/finance/service/invoice-requests/create',
      buildServiceCommandEnvelope(operation), text(operation.idempotencyKey), text(command.actorUid)
    )
    if (!text(response.targetBizCode) || text(response.targetBizType) !== 'invoice_request') {
      throw createError({ statusCode: 409, message: 'Finance invoice receipt target is invalid.' })
    }
    const receipt = validateServiceCommandReceipt(operation, response, {
      targetBizType: 'invoice_request', targetBizCode: text(response.targetBizCode)
    })
    const checkpoint = await io.callRuntime<Row>(`/v1/altoc/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`, {
      operationId: text(operation.operationId), fencingToken: operation.fencingToken, httpStatus: 200,
      targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
      receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
      receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode,
      responseSummarySha256: receipt.responseSummarySha256
    })
    return {
      succeeded: true, pending: false, receipt, checkpoint,
      invoiceRequestCode: receipt.targetBizCode,
      workflowOperationKey: `finance:invoice-request:${receipt.targetBizCode}:workflow-submit:v1`
    }
  } catch (error) {
    return { succeeded: false, pending: true, checkpoint: await fail(operation, io, error) }
  }
}
