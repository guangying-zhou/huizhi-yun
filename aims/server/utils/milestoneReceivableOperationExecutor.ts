import { createError } from 'h3'
import {
  buildServiceCommandEnvelope,
  classifyServiceOperationFailure,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  validateServiceCommandReceipt
} from '@hzy/foundation/server/utils/serviceOperation'
import type {
  ClaimedDeliveryOperation,
  RuntimeRow,
  ServiceTicketDeliveryOperationIO
} from './serviceTicketDeliveryOperationExecutor'

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): RuntimeRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RuntimeRow : {}
}

function validateOperation(operation: ClaimedDeliveryOperation, operationKey: string) {
  const command = objectBody(operation.command)
  const paymentTermId = text(command.paymentTermId)
  if (
    text(operation.operationKey) !== operationKey
    || text(operation.sourceApp) !== 'aims'
    || text(operation.targetApp) !== 'altoc'
    || text(operation.operationCode) !== 'aims.milestone.receivable-billable.v1'
    || text(operation.requiredCapability) !== 'altoc:receivable:mark-billable'
    || text(operation.idempotencyKey) !== operationKey
    || text(command.idempotencyKey) !== operationKey
    || !/^[1-9][0-9]*$/.test(paymentTermId)
    || !/^[1-9][0-9]*$/.test(text(command.milestoneId))
    || !text(command.projectCode)
    || !text(command.contractCode)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'integration_operation_identity_mismatch',
      message: 'Claimed milestone receivable operation is invalid.'
    })
  }
  return { command, paymentTermId }
}

async function checkpointFailure(operation: ClaimedDeliveryOperation, io: ServiceTicketDeliveryOperationIO, error: unknown) {
  const status = extractServiceOperationStatus(error)
  const failure = classifyServiceOperationFailure(error, status === 409
    ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) }
    : {})
  return await io.callRuntime<RuntimeRow>(
    `/v1/aims/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`,
    {
      operationId: text(operation.operationId),
      fencingToken: operation.fencingToken,
      httpStatus: failure.statusCode || 0,
      timedOut: failure.timedOut,
      networkError: failure.networkError,
      deliveryUncertain: failure.timedOut || failure.networkError,
      errorCode: failure.code,
      errorSummary: failure.summary,
      ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
    }
  )
}

export async function executeClaimedMilestoneReceivableOperation(
  operation: ClaimedDeliveryOperation,
  io: ServiceTicketDeliveryOperationIO,
  expectedOperationKey = text(operation.operationKey)
) {
  const operationKey = text(operation.operationKey)
  if (operationKey !== text(expectedOperationKey) || !operationKey || !text(operation.operationId) || !text(operation.fencingToken)) {
    throw createError({ statusCode: 409, message: 'Claimed milestone receivable lease metadata is invalid.' })
  }
  let paymentTermId: string
  try {
    ({ paymentTermId } = validateOperation(operation, operationKey))
  } catch (error) {
    const checkpoint = await checkpointFailure(operation, io, error)
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }
  if (!io.callAltocReceivable) {
    const checkpoint = await checkpointFailure(operation, io, createError({ statusCode: 503, message: 'Altoc receivable executor is unavailable.' }))
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }

  let result: RuntimeRow
  try {
    const response = await io.callAltocReceivable(buildServiceCommandEnvelope(operation), operationKey)
    result = validateServiceCommandReceipt(operation, response, {
      targetBizType: 'receivable_plan_set',
      targetBizCode: `payment-term:${paymentTermId}`
    }) as unknown as RuntimeRow
  } catch (error) {
    const checkpoint = await checkpointFailure(operation, io, error)
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }

  const checkpoint = await io.callRuntime<RuntimeRow>(
    `/v1/aims/integration-operations/${encodeURIComponent(operationKey)}:succeed`,
    {
      operationId: text(operation.operationId),
      fencingToken: operation.fencingToken,
      httpStatus: 200,
      targetReceiptId: text(result.receiptId),
      receiptOperationId: text(result.operationId),
      receiptOperationCode: text(result.operationCode),
      receiptIdempotencyKey: text(result.idempotencyKey),
      receiptCommandSchemaVersion: text(result.commandSchemaVersion),
      receiptCommandSha256: text(result.commandSha256),
      targetBizType: text(result.targetBizType),
      targetBizCode: text(result.targetBizCode),
      responseSummarySha256: text(result.responseSummarySha256)
    }
  )
  return { linked: true, synced: true, pending: false, operation: checkpoint, result }
}
