import { executeProductFeedbackOperation, isProductFeedbackOperation } from './productFeedbackOperation'
import type { H3Event } from 'h3'
import { drainIntegrationOperationDeadLetterNotifications } from '@hzy/foundation/server/utils/integrationOperationDeadLetterDrain'
import { publishIntegrationOperationDeadLetter } from '@hzy/foundation/server/utils/notifications'
import { callAltocScheduledRuntime, requireAltocScheduledRuntimeBinding, scheduledProductFeedbackTargetDeployment } from '~~/server/utils/scheduledRuntime'
import {
  createRequestOpsKnowledgeOperationIO,
  createScheduledOpsKnowledgeOperationIO,
  executeClaimedOpsKnowledgeOperation,
  type ClaimedOpsKnowledgeOperation
} from '~~/server/utils/serviceTicketOpsKnowledgeOperation'
import { executeClaimedContractActivationOperation, isContractActivationOperation } from '~~/server/utils/contractActivationOperation'
import { executeReceivableInvoiceOperation, isReceivableInvoiceOperation } from '~~/server/utils/receivableInvoiceOperation'
import { executeServiceTicketAimsOperation, isServiceTicketAimsOperation } from '~~/server/utils/serviceTicketAimsOperation'

type RuntimeRow = Record<string, unknown>

export interface IntegrationOperationDrainOptions {
  maxClaims: number
  maxWallTimeMs: number
  claimReserveMs?: number
}

export interface IntegrationOperationDrainResult {
  claimed: number
  succeeded: number
  checkpointedFailures: number
  empty: boolean
  stoppedBy: 'empty' | 'max_claims' | 'max_wall_time'
  notificationsPublished: number
  notificationFailures: number
}

const maxAllowedClaims = 25
const maxAllowedWallTimeMs = 45_000
const defaultClaimBudgetMs = 25_000

function validateDrainOptions(options: IntegrationOperationDrainOptions) {
  if (!Number.isSafeInteger(options.maxClaims) || options.maxClaims < 1 || options.maxClaims > maxAllowedClaims) {
    throw new Error(`maxClaims must be between 1 and ${maxAllowedClaims}.`)
  }
  if (!Number.isSafeInteger(options.maxWallTimeMs) || options.maxWallTimeMs < 12_000 || options.maxWallTimeMs > maxAllowedWallTimeMs) {
    throw new Error(`maxWallTimeMs must be between 12000 and ${maxAllowedWallTimeMs}.`)
  }
  const claimReserveMs = options.claimReserveMs ?? defaultClaimBudgetMs
  if (!Number.isSafeInteger(claimReserveMs) || claimReserveMs < 10_000 || claimReserveMs > options.maxWallTimeMs) {
    throw new Error('claimReserveMs must be between 10000 and maxWallTimeMs.')
  }
}

interface DrainBinding {
  tenant: string
  deployment: string
}

async function executeClaimedAltocOperation(operation: ClaimedOpsKnowledgeOperation, io: ReturnType<typeof createRequestOpsKnowledgeOperationIO>) {
  if (isProductFeedbackOperation(operation)) return await executeProductFeedbackOperation(operation, io)
  if (isServiceTicketAimsOperation(operation)) return await executeServiceTicketAimsOperation(operation, io)
  if (isReceivableInvoiceOperation(operation)) return await executeReceivableInvoiceOperation(operation, io)
  if (isContractActivationOperation(operation)) return await executeClaimedContractActivationOperation(operation, io)
  if (['altoc.ops-knowledge.codocs-link.v1', 'altoc.ops-knowledge.assets-link.v1'].includes(String(operation.operationCode || '').trim())) {
    return await executeClaimedOpsKnowledgeOperation(operation, io)
  }
  const checkpoint = await io.callRuntime<RuntimeRow>(`/v1/altoc/integration-operations/${encodeURIComponent(String(operation.operationKey || '').trim())}:fail`, {
    operationId: String(operation.operationId || '').trim(), fencingToken: operation.fencingToken,
    httpStatus: 409, conflictDisposition: 'permanent', errorCode: 'unsupported_integration_operation',
    errorSummary: 'Claimed Altoc operation code has no registered executor.'
  })
  return { succeeded: false, pending: false, checkpoint }
}

async function drainWithIO(
  options: IntegrationOperationDrainOptions,
  binding: DrainBinding,
  io: ReturnType<typeof createRequestOpsKnowledgeOperationIO>,
  event?: H3Event | null
): Promise<IntegrationOperationDrainResult> {
  const startedAt = Date.now()
  const claimReserveMs = options.claimReserveMs ?? defaultClaimBudgetMs
  let claimedCount = 0
  let succeeded = 0
  let checkpointedFailures = 0
  let empty = false
  const notificationResult = await drainIntegrationOperationDeadLetterNotifications('altoc', binding, {
    callRuntime: io.callRuntime,
    publish: item => publishIntegrationOperationDeadLetter(item, event),
    warn: (message, context) => console.warn(`[altoc] ${message}`, context)
  })

  while (
    claimedCount < options.maxClaims
    && options.maxWallTimeMs - (Date.now() - startedAt) >= claimReserveMs
  ) {
    const operation = await io.callRuntime<ClaimedOpsKnowledgeOperation | null>(
      '/v1/altoc/integration-operations:claim-next',
      {}
    )
    if (!operation) {
      empty = true
      break
    }
    if (
      operation.tenantCode !== binding.tenant
      || operation.deploymentCode !== binding.deployment
      || operation.sourceApp !== 'altoc'
    ) {
      throw new Error('Altoc scheduled claim escaped its configured tenant/deployment/source binding.')
    }
    claimedCount += 1
    let result
    try {
      result = await executeClaimedAltocOperation(operation, io)
    } catch (error) {
      console.warn('[altoc] integration operation item isolated after checkpoint failure', { operationId: operation.operationId, error })
      checkpointedFailures += 1
      continue
    }
    if (result.succeeded) {
      succeeded += 1
      continue
    }
    checkpointedFailures += 1
  }

  const stoppedBy = empty
    ? 'empty'
    : claimedCount >= options.maxClaims
      ? 'max_claims'
      : 'max_wall_time'
  return {
    claimed: claimedCount, succeeded, checkpointedFailures, empty, stoppedBy,
    notificationsPublished: notificationResult.published,
    notificationFailures: notificationResult.failures
  }
}

export async function drainIntegrationOperationsForEvent(
  event: H3Event,
  binding: DrainBinding,
  options: IntegrationOperationDrainOptions
) {
  validateDrainOptions(options)
  return await drainWithIO(options, binding, createRequestOpsKnowledgeOperationIO(event, {}), event)
}

export async function drainIntegrationOperations(
  options: IntegrationOperationDrainOptions
): Promise<IntegrationOperationDrainResult> {
  validateDrainOptions(options)
  const binding = requireAltocScheduledRuntimeBinding()
  const requestId = `altoc-drain-${crypto.randomUUID()}`

  const callRuntime = <T>(path: string, body: RuntimeRow) => callAltocScheduledRuntime<T>(path, {
    scope: 'altoc.write altoc:integration_operation:execute',
    method: 'POST',
    body,
    requestId
  })
  const io = createScheduledOpsKnowledgeOperationIO(callRuntime, scheduledProductFeedbackTargetDeployment())
  return await drainWithIO(options, binding, io)
}
