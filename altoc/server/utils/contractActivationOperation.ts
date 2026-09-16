import { createError } from 'h3'
import {
  buildServiceCommandEnvelope,
  classifyServiceOperationFailure,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  validateServiceCommandReceipt
} from '@hzy/foundation/server/utils/serviceOperation'
import type { ClaimedOpsKnowledgeOperation, OpsKnowledgeOperationIO } from './serviceTicketOpsKnowledgeOperation.ts'

type RuntimeRow = Record<string, unknown>

const projectOperation = 'altoc.contract-activation.aims-project.v1'
const milestoneOperation = 'altoc.contract-activation.aims-milestones.v1'

function text(value: unknown) {
  return String(value || '').trim()
}
function objectBody(value: unknown): RuntimeRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RuntimeRow : {}
}

function validate(operation: ClaimedOpsKnowledgeOperation) {
  const command = objectBody(operation.command)
  const operationCode = text(operation.operationCode)
  const projectCode = text(command.projectCode)
  if (
    text(operation.sourceApp) !== 'altoc'
    || text(operation.targetApp) !== 'aims'
    || text(operation.requiredCapability) !== 'aims:write'
    || ![projectOperation, milestoneOperation].includes(operationCode)
    || !projectCode
    || !text(command.contractCode)
    || !text(command.planKey || command.projectPlanKey)
    || text(operation.idempotencyKey) !== text(operation.operationKey)
  ) {
    throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'Claimed contract activation operation is invalid.' })
  }
  return { command, operationCode, projectCode }
}

function failure(error: unknown) {
  const status = extractServiceOperationStatus(error)
  return classifyServiceOperationFailure(error, status === 409 ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) } : {})
}

export async function executeClaimedContractActivationOperation(operation: ClaimedOpsKnowledgeOperation, io: OpsKnowledgeOperationIO) {
  let valid: ReturnType<typeof validate>
  try {
    valid = validate(operation)
  } catch (error) {
    const problem = failure(error)
    const checkpoint = await io.callRuntime<RuntimeRow>(`/v1/altoc/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`, {
      operationId: text(operation.operationId), fencingToken: operation.fencingToken, httpStatus: problem.statusCode || 0,
      timedOut: problem.timedOut, networkError: problem.networkError, deliveryUncertain: problem.timedOut || problem.networkError,
      errorCode: problem.code, errorSummary: problem.summary, ...(problem.conflictDisposition ? { conflictDisposition: problem.conflictDisposition } : {})
    })
    return { succeeded: false, pending: true, target: 'aims', checkpoint }
  }
  let response: RuntimeRow
  let receipt: ReturnType<typeof validateServiceCommandReceipt>
  try {
    const path = valid.operationCode === projectOperation
      ? '/api/v1/service/projects/from-contract'
      : `/api/v1/service/projects/${encodeURIComponent(valid.projectCode)}/payment-milestones:sync`
    response = await io.callService<RuntimeRow>('aims', 'aims:write', path, buildServiceCommandEnvelope(operation), text(operation.idempotencyKey))
    receipt = validateServiceCommandReceipt(operation, response, {
      targetBizType: valid.operationCode === projectOperation ? 'project' : 'project_milestones',
      targetBizCode: valid.projectCode
    })
  } catch (error) {
    const problem = failure(error)
    const checkpoint = await io.callRuntime<RuntimeRow>(`/v1/altoc/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`, {
      operationId: text(operation.operationId), fencingToken: operation.fencingToken, httpStatus: problem.statusCode || 0,
      timedOut: problem.timedOut, networkError: problem.networkError, deliveryUncertain: problem.timedOut || problem.networkError,
      errorCode: problem.code, errorSummary: problem.summary, ...(problem.conflictDisposition ? { conflictDisposition: problem.conflictDisposition } : {})
    })
    return { succeeded: false, pending: true, target: 'aims', checkpoint }
  }
  const checkpoint = await io.callRuntime<RuntimeRow>(`/v1/altoc/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`, {
    operationId: text(operation.operationId), fencingToken: operation.fencingToken, httpStatus: 200,
    targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
    receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
    receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode,
    responseSummarySha256: receipt.responseSummarySha256
  })
  return { succeeded: true, pending: false, target: 'aims', result: objectBody(response.result), receipt, checkpoint }
}

export function isContractActivationOperation(operation: ClaimedOpsKnowledgeOperation) {
  return [projectOperation, milestoneOperation].includes(text(operation.operationCode))
}

export function selectContractActivationProjectForLine(lineCode: string, projectResults: RuntimeRow[]) {
  return projectResults.find(result => Array.isArray(result.lineCodes) && result.lineCodes.map(text).includes(text(lineCode)))
    || projectResults[0]
    || {}
}

export function expectedContractActivationOperationsSucceeded(expected: boolean, operationCode: string, operations: RuntimeRow[]) {
  const matching = operations.filter(item => text(item.operationCode) === operationCode)
  return expected
    ? matching.length > 0 && matching.every(item => item.succeeded === true)
    : matching.length === 0
}
