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

const contributionOperationCode = 'aims.people-contributions.replace-scope.v1'

function text(value: unknown) {
  return String(value || '').trim()
}

function row(value: unknown): RuntimeRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RuntimeRow : {}
}

function validContributionOperation(operation: ClaimedDeliveryOperation) {
  const command = operation.command || {}
  return text(operation.sourceApp) === 'aims'
    && text(operation.targetApp) === 'people'
    && text(operation.operationCode) === contributionOperationCode
    && text(operation.requiredCapability) === 'people:write'
    && Boolean(text(command.cycle_code))
    && Boolean(text(command.project_code))
    && Number(command.source_revision) > 0
}

export async function executeClaimedPeopleContributionOperation(
  operation: ClaimedDeliveryOperation,
  io: ServiceTicketDeliveryOperationIO
) {
  const command = operation.command || {}
  const fail = async (error: unknown) => {
    const status = extractServiceOperationStatus(error)
    const failure = classifyServiceOperationFailure(error, status === 409
      ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) }
      : {})
    const checkpoint = await io.callRuntime<RuntimeRow>(
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
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }

  if (!validContributionOperation(operation) || !io.callPeople) {
    return await fail(createError({
      statusCode: validContributionOperation(operation) ? 503 : 409,
      message: validContributionOperation(operation)
        ? 'People executor unavailable.'
        : 'Contribution operation identity mismatch.'
    }))
  }

  try {
    const response = await io.callPeople(
      buildServiceCommandEnvelope(operation),
      text(operation.idempotencyKey)
    )
    const receipt = validateServiceCommandReceipt(operation, response, {
      targetBizType: 'performance_contribution_scope',
      targetBizCode: `${text(command.cycle_code)}:${text(command.project_code)}`
    })
    const checkpoint = await io.callRuntime<RuntimeRow>(
      `/v1/aims/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`,
      {
        operationId: text(operation.operationId),
        fencingToken: operation.fencingToken,
        httpStatus: 200,
        targetReceiptId: receipt.receiptId,
        receiptOperationId: receipt.operationId,
        receiptOperationCode: receipt.operationCode,
        receiptIdempotencyKey: receipt.idempotencyKey,
        receiptCommandSchemaVersion: receipt.commandSchemaVersion,
        receiptCommandSha256: receipt.commandSha256,
        targetBizType: receipt.targetBizType,
        targetBizCode: receipt.targetBizCode,
        responseSummarySha256: receipt.responseSummarySha256
      }
    )
    const result = row(response.result)
    return {
      linked: true,
      synced: true,
      pending: false,
      operation: checkpoint,
      result,
      staleSkipped: result.staleSkipped === true
    }
  } catch (error) {
    return await fail(error)
  }
}
