import { callCodocsOperationService } from '../../../server/utils/codocsOperationTransport'
import { sendWorkItemCompletion } from '../../../server/utils/workItemCompletionTransport'
import { unifiedIntegrationOperationRoute } from '../../../server/utils/unifiedIntegrationOperationRoute'
import { createError, type H3Event } from 'h3'
import { drainWithIO, type IntegrationOperationDrainOptions } from '../../../server/utils/integrationOperationDrainCore'
import { executeClaimedWorkItemCompletionOperation } from '../../../server/utils/workItemCompletionOperationExecutor'
import { executeClaimedProductDocumentOperation } from '../../../server/utils/productDocumentOperationExecutor'
import { executeClaimedCompanyWeeklySummaryOperation } from '../../../server/utils/companyWeeklySummaryOperationExecutor'
import { drainAimsDueNotifications } from '../../../server/utils/dueNotificationDrain'
import { isInProcessMilestoneRolloverOwner } from '../../../server/utils/milestoneRolloverOwner'
import type { ClaimedDeliveryOperation, ServiceTicketDeliveryOperationIO } from '../../../server/utils/serviceTicketDeliveryOperationExecutor'

// Owning entry receives narrow IO, not a service token or browser trust flag.
export async function drainHostAimsScheduler(input: {
  event: H3Event
  tenant: string
  deployment: string
  io: ServiceTicketDeliveryOperationIO
  options: IntegrationOperationDrainOptions
  due: Parameters<typeof drainAimsDueNotifications>[0]
  rollover: () => Promise<Record<string, unknown>>
}) {
  const execute = async (operation: ClaimedDeliveryOperation, io: ServiceTicketDeliveryOperationIO) => {
    switch (operation.operationCode) {
      case 'aims.work-item.completion.workflow-submit.v1': return await executeClaimedWorkItemCompletionOperation(operation, io)
      case 'aims.codocs.product-document.create.v1': return await executeClaimedProductDocumentOperation(operation, io)
      case 'aims.company-weekly-summary.codocs-publish.v1': return await executeClaimedCompanyWeeklySummaryOperation(operation, io)
      default: throw createError({ statusCode: 409, statusMessage: 'aims_retired_operation_requires_closeout' })
    }
  }
  const result = await drainWithIO(input.options, input, input.io, input.event, execute)
  let milestoneRollover: Record<string, unknown>
  try {
    milestoneRollover = await input.rollover()
  } catch (error) {
    if (!isInProcessMilestoneRolloverOwner(error)) throw error
    milestoneRollover = { skipped: 'runtime_scheduler_owner' }
  }
  const dueNotifications = await drainAimsDueNotifications(input.due)
  return { ...result, milestoneRollover, dueNotifications }
}

export function createHostAimsSchedulerIO(event: H3Event, runtime: ServiceTicketDeliveryOperationIO['callRuntime']) {
  const callRuntime = async <T>(path: string, body: Record<string, unknown>) => {
    const routed = unifiedIntegrationOperationRoute(path, body)
    return await runtime<T>(routed.path, routed.body)
  }
  return {
    callRuntime,
    callWorkflowWorkItemCompletion: (command, operation) => sendWorkItemCompletion(event, operation, command),
    callCodocsProductDocument: (command, operation) => callCodocsOperationService(event, command, operation.idempotencyKey, '', operation),
    callCodocsCompanySummary: (command, key, period, operation) => callCodocsOperationService(event, command, key, period, operation),
    callAltoc: async () => { throw createError({ statusCode: 410, statusMessage: 'aims_operation_retired' }) }
  } satisfies ServiceTicketDeliveryOperationIO
}
