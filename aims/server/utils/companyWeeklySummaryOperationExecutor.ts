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

function validateOperation(operation: ClaimedDeliveryOperation, expectedOperationKey: string) {
  const command = objectBody(operation.command)
  const summaryVersionId = text(command.summaryVersionId)
  const revisionNo = text(command.revisionNo)
  const markdownSha256 = text(command.markdownSha256)
  const periodKey = text(command.periodKey)
  if (
    text(operation.operationKey) !== expectedOperationKey
    || text(operation.sourceApp) !== 'aims'
    || text(operation.targetApp) !== 'codocs'
    || text(operation.operationCode) !== 'aims.company-weekly-summary.codocs-publish.v1'
    || text(operation.requiredCapability) !== 'codocs:company-weekly-summary:publish'
    || text(operation.commandSchemaVersion) !== 'v1'
    || text(operation.idempotencyKey) !== expectedOperationKey
    || !text(operation.tenantCode)
    || !text(operation.deploymentCode)
    || text(command.idempotencyKey) !== expectedOperationKey
    || !/^[1-9][0-9]*$/.test(summaryVersionId)
    || !/^[1-9][0-9]*$/.test(revisionNo)
    || !/^[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3])$/.test(periodKey)
    || !/^[a-f0-9]{64}$/.test(markdownSha256)
    || !text(command.title)
    || !Array.isArray(command.recipientUids)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'integration_operation_identity_mismatch',
      message: 'Claimed company weekly summary operation is invalid.'
    })
  }
  return { command, summaryVersionId, periodKey, markdownSha256 }
}

async function checkpointFailure(
  operation: ClaimedDeliveryOperation,
  io: ServiceTicketDeliveryOperationIO,
  error: unknown
) {
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

export async function executeClaimedCompanyWeeklySummaryOperation(
  operation: ClaimedDeliveryOperation,
  io: ServiceTicketDeliveryOperationIO,
  expectedOperationKey = text(operation.operationKey)
) {
  const operationKey = text(operation.operationKey)
  if (!operationKey || operationKey !== text(expectedOperationKey) || !text(operation.operationId) || !text(operation.fencingToken)) {
    throw createError({ statusCode: 409, message: 'Claimed company weekly summary lease metadata is invalid.' })
  }
  let summaryVersionId: string
  let periodKey: string
  let markdownSha256: string
  try {
    ({ summaryVersionId, periodKey, markdownSha256 } = validateOperation(operation, operationKey))
  } catch (error) {
    const checkpoint = await checkpointFailure(operation, io, error)
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }
  if (!io.callCodocsCompanySummary) {
    const checkpoint = await checkpointFailure(
      operation,
      io,
      createError({ statusCode: 503, message: 'Codocs company summary executor is unavailable.' })
    )
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }

  let result: RuntimeRow
  try {
    const content = await io.callRuntime<RuntimeRow>(
      `/v1/aims/company-weekly-summary-versions/${encodeURIComponent(summaryVersionId)}:publish-content`,
      { markdownSha256 }
    )
    if (
      text(content.summaryVersionId) !== summaryVersionId
      || text(content.periodKey) !== periodKey
      || text(content.markdownSha256) !== markdownSha256
      || !String(content.markdownContent || '')
    ) {
      throw createError({ statusCode: 409, message: 'Immutable company summary content does not match the operation.' })
    }
    const response = await io.callCodocsCompanySummary(
      {
        ...buildServiceCommandEnvelope(operation),
        markdownContent: String(content.markdownContent || '')
      },
      operationKey,
      periodKey,
      operation
    )
    result = validateServiceCommandReceipt(operation, response, {
      targetBizType: 'company_weekly_summary_document',
      targetBizCode: periodKey
    }) as unknown as RuntimeRow
    if (
      !text(result.documentUuid)
      || !/^[1-9][0-9]*$/.test(text(result.documentVersionId))
      || !/^[1-9][0-9]*$/.test(text(result.documentVersionNum))
      || text(result.markdownSha256) !== markdownSha256
    ) {
      throw createError({ statusCode: 409, message: 'Codocs company summary receipt is incomplete.' })
    }
  } catch (error) {
    const checkpoint = await checkpointFailure(operation, io, error)
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
        responseSummarySha256: text(result.responseSummarySha256),
        documentUuid: text(result.documentUuid),
        documentVersionId: Number(result.documentVersionId),
        documentVersionNum: Number(result.documentVersionNum),
        markdownSha256: text(result.markdownSha256),
        documentUrl: text(result.documentUrl)
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
