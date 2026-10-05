import { createError, type H3Event } from 'h3'
import {
  classifyServiceOperationFailure,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  validateServiceCommandReceipt
} from '@hzy/foundation/server/utils/serviceOperation'

export type DirectoryLifecycleRow = Record<string, unknown>

export interface ClaimedDirectoryLifecycleOperation extends DirectoryLifecycleRow {
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
  command: DirectoryLifecycleRow
  fencingToken: number | string
}

const employmentCode = 'people.directory.employment-sync.v1'
const offboardingCode = 'people.directory.offboarding-disable.v1'
const text = (value: unknown) => String(value || '').trim()
const record = (value: unknown): DirectoryLifecycleRow => value && typeof value === 'object' && !Array.isArray(value) ? value as DirectoryLifecycleRow : {}

export function directoryLifecycleOperationContract(operation: ClaimedDirectoryLifecycleOperation) {
  const command = record(operation.command)
  const code = text(operation.operationCode)
  const employment = code === employmentCode
  const capability = employment ? 'console:directory-employment:sync' : 'console:directory-offboarding:disable'
  if (text(operation.sourceApp) !== 'people' || text(operation.targetApp) !== 'console'
    || ![employmentCode, offboardingCode].includes(code) || text(operation.requiredCapability) !== capability
    || !text(command.employeeUid) || Number(command.sourceRevision) <= 0 || !text(command.snapshotHash)) {
    throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'People Directory lifecycle operation is invalid.' })
  }
  return { command, employment, capability }
}

async function checkpointFailure(
  operation: ClaimedDirectoryLifecycleOperation,
  error: unknown,
  callRuntime: (path: string, body: DirectoryLifecycleRow) => Promise<DirectoryLifecycleRow>
) {
  const status = extractServiceOperationStatus(error)
  const failure = classifyServiceOperationFailure(error, status === 409 ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) } : {})
  const unclassifiedTransient = failure.retryable && !failure.statusCode && !failure.timedOut && !failure.networkError
  return await callRuntime(`/v1/people/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`, {
    operationId: text(operation.operationId),
    fencingToken: operation.fencingToken,
    httpStatus: failure.statusCode || 0,
    timedOut: failure.timedOut,
    networkError: failure.networkError || unclassifiedTransient,
    deliveryUncertain: failure.timedOut || failure.networkError,
    errorCode: failure.code,
    errorSummary: failure.summary,
    ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
  })
}

export async function executeDirectoryLifecycleOperation(
  operation: ClaimedDirectoryLifecycleOperation,
  event: H3Event | null,
  callRuntime: (path: string, body: DirectoryLifecycleRow) => Promise<DirectoryLifecycleRow>,
  callTarget: (event: H3Event | null, operation: ClaimedDirectoryLifecycleOperation) => Promise<DirectoryLifecycleRow>
) {
  try {
    directoryLifecycleOperationContract(operation)
    const response = await callTarget(event, operation)
    const receipt = validateServiceCommandReceipt(operation, response, { targetBizType: 'directory_user', targetBizCode: text(operation.command.employeeUid) })
    const targetResult = record(response.result)
    const chainPending = Boolean(text(targetResult.platformOperationKey)) && text(targetResult.platformStatus) !== 'succeeded'
    const checkpoint = await callRuntime(`/v1/people/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`, {
      operationId: text(operation.operationId),
      fencingToken: operation.fencingToken,
      targetReceiptId: receipt.receiptId,
      receiptOperationId: receipt.operationId,
      receiptOperationCode: receipt.operationCode,
      receiptIdempotencyKey: receipt.idempotencyKey,
      receiptCommandSchemaVersion: receipt.commandSchemaVersion,
      receiptCommandSha256: receipt.commandSha256,
      targetBizType: receipt.targetBizType,
      targetBizCode: receipt.targetBizCode,
      responseSummarySha256: receipt.responseSummarySha256
    })
    return { linked: true, synced: true, pending: false, chainPending, operation: checkpoint, result: targetResult }
  } catch (error) {
    const checkpoint = await checkpointFailure(operation, error, callRuntime)
    return { linked: true, synced: false, pending: true, operation: checkpoint }
  }
}
