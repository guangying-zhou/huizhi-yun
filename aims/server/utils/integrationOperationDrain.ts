import type { H3Event } from 'h3'
import { drainIntegrationOperationDeadLetterNotifications } from '@hzy/foundation/server/utils/integrationOperationDeadLetterDrain'
import { publishIntegrationOperationDeadLetter } from '@hzy/foundation/server/utils/notifications'
import { callAimsScheduledRuntime, requireAimsScheduledRuntimeBinding } from '~~/server/utils/scheduledRuntime'
import {
  createRequestServiceTicketDeliveryOperationIO,
  createScheduledServiceTicketDeliveryOperationIO
} from '~~/server/utils/serviceTicketDeliveryOperation'
import type { ClaimedDeliveryOperation } from '~~/server/utils/serviceTicketDeliveryOperationExecutor'
import { executeClaimedAimsOperation } from '~~/server/utils/claimedAimsOperationExecutor'

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

async function drainWithIO(
  options: IntegrationOperationDrainOptions,
  binding: DrainBinding,
  io: ReturnType<typeof createRequestServiceTicketDeliveryOperationIO>,
  event?: H3Event | null
): Promise<IntegrationOperationDrainResult> {
  const startedAt = Date.now()
  const claimReserveMs = options.claimReserveMs ?? defaultClaimBudgetMs
  let claimedCount = 0
  let succeeded = 0
  let checkpointedFailures = 0
  let empty = false
  const notificationResult = await drainIntegrationOperationDeadLetterNotifications('aims', binding, {
    callRuntime: io.callRuntime,
    publish: item => publishIntegrationOperationDeadLetter(item, event),
    warn: (message, context) => console.warn(`[aims] ${message}`, context)
  })

  while (
    claimedCount < options.maxClaims
    && options.maxWallTimeMs - (Date.now() - startedAt) >= claimReserveMs
  ) {
    const operation = await io.callRuntime<ClaimedDeliveryOperation | null>(
      '/v1/aims/integration-operations:claim-next',
      {}
    )
    if (!operation) {
      empty = true
      break
    }
    if (
      operation.tenantCode !== binding.tenant
      || operation.deploymentCode !== binding.deployment
      || operation.sourceApp !== 'aims'
    ) {
      throw new Error('Aims scheduled claim escaped its configured tenant/deployment/source binding.')
    }
    claimedCount += 1
    let result
    try {
      result = await executeClaimedAimsOperation(operation, io)
    } catch (error) {
      console.warn('[aims] integration operation item isolated after checkpoint failure', { operationId: operation.operationId, error })
      checkpointedFailures += 1
      continue
    }
    if (result.synced) {
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
  return await drainWithIO(options, binding, createRequestServiceTicketDeliveryOperationIO(event), event)
}

export async function drainIntegrationOperations(
  options: IntegrationOperationDrainOptions
): Promise<IntegrationOperationDrainResult> {
  validateDrainOptions(options)
  const binding = requireAimsScheduledRuntimeBinding()
  const requestId = `aims-drain-${crypto.randomUUID()}`

  const callRuntime = <T>(path: string, body: RuntimeRow) => callAimsScheduledRuntime<T>(path, {
    scope: 'aims.write aims:integration_operation:execute',
    method: 'POST',
    body,
    requestId
  })
  const io = createScheduledServiceTicketDeliveryOperationIO(callRuntime, {
    codocs: binding.codocsTargetDeployment,
    altoc: binding.altocTargetDeployment,
    finance: binding.financeTargetDeployment
  })
  return await drainWithIO(options, binding, io)
}
