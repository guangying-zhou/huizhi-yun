import { executeClaimedProductFeedbackProgressOperation } from './productFeedbackProgressOperationExecutor'
import { executeClaimedWorkItemCompletionOperation } from './workItemCompletionOperationExecutor'
import { executeClaimedProductCostRulesOperation } from './productCostRulesOperationExecutor'
import { executeClaimedProductFeedbackStatusOperation } from './productFeedbackStatusOperationExecutor'
import { executeClaimedProductDocumentOperation } from './productDocumentOperationExecutor'
import { executeClaimedMilestoneReceivableOperation } from './milestoneReceivableOperationExecutor'
import { executeClaimedPeopleContributionOperation } from './peopleContributionOperationExecutor'
import { executeClaimedCompanyWeeklySummaryOperation } from './companyWeeklySummaryOperationExecutor'
import {
  executeClaimedServiceTicketDeliveryOperation,
  type ClaimedDeliveryOperation,
  type ServiceTicketDeliveryOperationIO
} from './serviceTicketDeliveryOperationExecutor'

export async function executeClaimedAimsOperation(
  operation: ClaimedDeliveryOperation,
  io: ServiceTicketDeliveryOperationIO,
  expectedOperationKey = String(operation.operationKey || '').trim()
) {
  switch (String(operation.operationCode || '').trim()) {
    case 'aims.work-item.completion.workflow-submit.v1':
      return await executeClaimedWorkItemCompletionOperation(operation, io)
    case 'aims.finance.product-cost.rules.replace.v1':
      return await executeClaimedProductCostRulesOperation(operation, io)
    case 'aims.altoc.product-feedback.update-progress.v1':
      return await executeClaimedProductFeedbackProgressOperation(operation, io)
    case 'aims.altoc.product-feedback.update-status.v1':
      return await executeClaimedProductFeedbackStatusOperation(operation, io)
    case 'aims.codocs.product-document.create.v1':
      return await executeClaimedProductDocumentOperation(operation, io)
    case 'aims.work-item.ticket-result.v1':
      return await executeClaimedServiceTicketDeliveryOperation(operation, io, expectedOperationKey)
    case 'aims.milestone.receivable-billable.v1':
      return await executeClaimedMilestoneReceivableOperation(operation, io, expectedOperationKey)
    case 'aims.people-contributions.replace-scope.v1':
      return await executeClaimedPeopleContributionOperation(operation, io)
    case 'aims.company-weekly-summary.codocs-publish.v1':
      return await executeClaimedCompanyWeeklySummaryOperation(operation, io, expectedOperationKey)
    default: {
      const operationKey = String(operation.operationKey || '').trim()
      const checkpoint = await io.callRuntime<Record<string, unknown>>(
        `/v1/aims/integration-operations/${encodeURIComponent(operationKey)}:fail`,
        {
          operationId: String(operation.operationId || '').trim(),
          fencingToken: operation.fencingToken,
          httpStatus: 409,
          timedOut: false,
          networkError: false,
          deliveryUncertain: false,
          errorCode: 'integration_operation_code_unsupported',
          errorSummary: 'Unsupported Aims integration operation code.',
          conflictDisposition: 'permanent'
        }
      )
      return { linked: true, synced: false, pending: true, operation: checkpoint }
    }
  }
}
