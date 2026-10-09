import { createError, type H3Event } from 'h3'
import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { callAimsScheduledRuntime, requireAimsScheduledRuntimeBinding } from './scheduledRuntime'
import { callAimsUnifiedDueNotification, callAimsUnifiedMilestoneRollover } from './unifiedSchedulerRuntime'
import { isInProcessMilestoneRolloverOwner } from './milestoneRolloverOwner'
import { drainAimsDueNotifications } from './dueNotificationDrain'
import {
  createRequestServiceTicketDeliveryOperationIO,
  createUnifiedRequestServiceTicketDeliveryOperationIO,
  createScheduledServiceTicketDeliveryOperationIO
} from './serviceTicketDeliveryOperation'
import { executeClaimedAimsOperation } from './claimedAimsOperationExecutor'

import { drainWithIO, validateDrainOptions, type DrainBinding, type IntegrationOperationDrainOptions, type IntegrationOperationDrainResult } from './integrationOperationDrainCore'

export type { IntegrationOperationDrainOptions, IntegrationOperationDrainResult } from './integrationOperationDrainCore'
type RuntimeRow = Record<string, unknown>

export async function drainIntegrationOperationsForEvent(
  event: H3Event,
  binding: DrainBinding,
  options: IntegrationOperationDrainOptions
) {
  validateDrainOptions(options)
  const verified = await requireTenantGatewaySchedulerRequest(event, 'aims')
  if (binding.tenant !== verified.tenant || binding.deployment !== verified.deployment
    || (binding.schedulerStorage || '') !== verified.schedulerStorage
    || (binding.schedulerGeneration || '') !== verified.schedulerGeneration) {
    throw createError({ statusCode: 403, message: 'Scheduler binding does not match the signed wake.' })
  }
  if (verified.schedulerStorage && !['unified', 'recovered'].includes(verified.schedulerStorage)) {
    throw createError({ statusCode: 503, message: 'Registered scheduler storage is disabled.' })
  }
  const unified = ['unified', 'recovered'].includes(verified.schedulerStorage)
  const io = unified
    ? createUnifiedRequestServiceTicketDeliveryOperationIO(event, verified.schedulerGeneration, verified)
    : createRequestServiceTicketDeliveryOperationIO(event)
  const result = await drainWithIO(options, verified, io, event, executeClaimedAimsOperation)
  if (!unified) return result
  // On the unified scheduler the signed wake is the only rollover owner; the
  // local daily cron is refused by the Runtime. A rollover failure must not
  // turn an already checkpointed drain into a failed wake.
  let milestoneRollover: Record<string, unknown>
  try {
    milestoneRollover = await callAimsUnifiedMilestoneRollover<Record<string, unknown>>(event, verified.schedulerGeneration)
  } catch (error) {
    if (isInProcessMilestoneRolloverOwner(error)) {
      milestoneRollover = { skipped: 'runtime_scheduler_owner' }
    } else {
      console.warn('[aims] unified milestone rollover failed; next signed wake retries', { requestId: verified.requestId, error: String((error as Error)?.message || error) })
      milestoneRollover = { failed: true }
    }
  }
  // Due notifications follow the same owner. The drain keeps its own feature
  // flag, and a small budget leaves the wake inside its Gateway timeout.
  let dueNotifications: Record<string, unknown>
  try {
    dueNotifications = await drainAimsDueNotifications({
      event,
      pageSize: 50,
      maxPagesPerStream: 2,
      maxWallTimeMs: 10_000,
      runtime: (path, body) => callAimsUnifiedDueNotification(event, path, body, verified.schedulerGeneration)
    })
  } catch (error) {
    console.warn('[aims] unified due notifications failed; next signed wake retries', { requestId: verified.requestId, error: String((error as Error)?.message || error) })
    dueNotifications = { failed: true }
  }
  return { ...result, milestoneRollover, dueNotifications }
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
    finance: binding.financeTargetDeployment,
    workflow: binding.workflowTargetDeployment
  }, options.taskContext)
  return await drainWithIO(options, binding, io, undefined, executeClaimedAimsOperation)
}
