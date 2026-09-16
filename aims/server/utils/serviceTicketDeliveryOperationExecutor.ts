import { createError } from 'h3'
import {
  buildServiceCommandEnvelope,
  classifyServiceOperationFailure,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  validateServiceCommandReceipt
} from '@hzy/foundation/server/utils/serviceOperation'

export type RuntimeRow = Record<string, unknown>

export interface ClaimedDeliveryOperation extends RuntimeRow {
  operationId: string
  operationKey: string
  tenantCode: string
  deploymentCode: string
  sourceApp: string
  targetApp: string
  operationCode: string
  requiredCapability: string
  idempotencyKey: string
  commandSchemaVersion: string
  commandSha256: string
  correlationKey?: string
  fencingToken: number | string
  command: RuntimeRow
}

export interface ServiceTicketDeliveryOperationIO {
  callFinanceProductCostRules?: (envelope: RuntimeRow, operation: ClaimedDeliveryOperation) => Promise<RuntimeRow>
  callAltocProductFeedbackStatus?: (envelope: RuntimeRow, operation: ClaimedDeliveryOperation) => Promise<RuntimeRow>
  callAltocProductFeedbackProgress?: (envelope: RuntimeRow, operation: ClaimedDeliveryOperation) => Promise<RuntimeRow>
  callCodocsProductDocument?: (envelope: RuntimeRow, operation: ClaimedDeliveryOperation) => Promise<RuntimeRow>
  callRuntime: <T>(path: string, body: RuntimeRow) => Promise<T>
  callAltoc: (command: RuntimeRow, idempotencyKey: string) => Promise<RuntimeRow>
  callAltocReceivable?: (command: RuntimeRow, idempotencyKey: string) => Promise<RuntimeRow>
  callPeople?: (command: RuntimeRow, idempotencyKey: string) => Promise<RuntimeRow>
  callCodocsCompanySummary?: (
    command: RuntimeRow,
    idempotencyKey: string,
    periodKey: string,
    operation: ClaimedDeliveryOperation
  ) => Promise<RuntimeRow>
}

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): RuntimeRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RuntimeRow
  return {}
}

function validateClaimedDeliveryOperation(operation: ClaimedDeliveryOperation, operationKey: string) {
  const command = objectBody(operation.command)
  if (
    text(operation.operationKey) !== operationKey
    || text(operation.sourceApp) !== 'aims'
    || text(operation.targetApp) !== 'altoc'
    || text(operation.operationCode) !== 'aims.work-item.ticket-result.v1'
    || text(operation.requiredCapability) !== 'altoc:service-ticket:delivery-result:sync'
    || text(operation.idempotencyKey) !== operationKey
    || !text(command.ticketCode)
    || !text(command.workItemKey)
    || !text(command.deliveryStatus)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'integration_operation_identity_mismatch',
      message: 'Claimed service ticket delivery operation is invalid.'
    })
  }
  return command
}

export async function executeClaimedServiceTicketDeliveryOperation(
  operation: ClaimedDeliveryOperation,
  io: ServiceTicketDeliveryOperationIO,
  expectedOperationKey = text(operation.operationKey)
) {
  const operationKey = text(operation.operationKey)
  if (operationKey !== text(expectedOperationKey) || !operationKey || !text(operation.operationId) || !text(operation.fencingToken)) {
    throw createError({ statusCode: 409, message: 'Claimed service ticket delivery lease metadata is invalid.' })
  }

  let command: RuntimeRow
  try {
    command = validateClaimedDeliveryOperation(operation, operationKey)
  } catch (error) {
    const status = extractServiceOperationStatus(error)
    const failure = classifyServiceOperationFailure(error, status === 409
      ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) }
      : {})
    const checkpoint = await io.callRuntime<RuntimeRow>(
      `/v1/aims/integration-operations/${encodeURIComponent(operationKey)}:fail`,
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
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }

  let result: RuntimeRow
  try {
    const response = await io.callAltoc(buildServiceCommandEnvelope(operation), operationKey)
    result = validateServiceCommandReceipt(operation, response, {
      targetBizType: 'service_ticket',
      targetBizCode: text(command.ticketCode)
    }) as unknown as RuntimeRow
  } catch (error) {
    const status = extractServiceOperationStatus(error)
    const failure = classifyServiceOperationFailure(error, status === 409
      ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) }
      : {})
    const checkpoint = await io.callRuntime<RuntimeRow>(
      `/v1/aims/integration-operations/${encodeURIComponent(operationKey)}:fail`,
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
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }

  try {
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
  } catch {
    return {
      linked: true,
      synced: false,
      pending: true,
      errorCode: 'integration_checkpoint_unavailable',
      operation: null,
      result
    }
  }
}
