import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import {
  drainWorkflowActionableLifecycleOutbox,
  drainWorkflowCallbackOutbox,
  drainWorkflowNotificationOutbox,
  workflowDeliveryDiagnostics
} from '~~/server/utils/dataRuntime'
import { workflowEffectCheckpointTokenDenials } from '~~/server/utils/effectCheckpointTokenDenials'
import { workflowResultNotificationPublishFailures } from '~~/server/utils/runtimeNotifications'

export default defineEventHandler(async (event) => {
  await requireTenantGatewaySchedulerRequest(event, 'workflow')
  const tokenDeniedBefore = workflowEffectCheckpointTokenDenials()
  // Creation notifications first: the Runtime holds a lifecycle CAS back until
  // the projection it closes has been created.
  const notifications = await drainWorkflowNotificationOutbox(event)
  const actionableLifecycles = await drainWorkflowActionableLifecycleOutbox(event)
  const callbacks = await drainWorkflowCallbackOutbox(event)
  const diagnostics = await workflowDeliveryDiagnostics(event)
  const tokenDeniedTotal = workflowEffectCheckpointTokenDenials()
  if (diagnostics.notification.abandoned + diagnostics.actionable.abandoned + diagnostics.callback.abandoned > 0) {
    console.error('[WorkflowDelivery] abandoned_effects', {
      notification: diagnostics.notification.abandoned,
      actionable: diagnostics.actionable.abandoned,
      callback: diagnostics.callback.abandoned,
      dependencyBlocked: diagnostics.dependencyBlocked,
      abandonedDependencyBlocked: diagnostics.abandonedDependencyBlocked
    })
  }
  return {
    code: 0,
    data: {
      processed: callbacks.length,
      delivered: callbacks.filter(item => item.status === 'delivered').length,
      failed: callbacks.filter(item => item.status === 'failed').length,
      notifications: {
        processed: notifications.length,
        published: notifications.filter(item => item.status === 'published').length,
        skipped: notifications.filter(item => item.status === 'skipped').length,
        failed: notifications.filter(item => item.status === 'failed').length
      },
      actionable: {
        processed: actionableLifecycles.length,
        delivered: actionableLifecycles.filter(item => item.status === 'delivered').length,
        pending: actionableLifecycles.filter(item => item.status === 'pending').length,
        invalid: actionableLifecycles.filter(item => item.status === 'invalid').length
      },
      diagnostics,
      // In-process counter of effect checkpoints rejected with 401/403 by
      // service-token issuance or Runtime scope checks (this drain / process).
      checkpointTokenDenied: {
        drain: tokenDeniedTotal - tokenDeniedBefore,
        processTotal: tokenDeniedTotal
      },
      // In-process counter of in-request "result" notification (approved /
      // rejected-not-to_previous / withdrawn) publishes that failed or were
      // skipped since this process started. These notifications have no
      // durable outbox, so the drain above never redelivers or resets them;
      // this is a process-lifetime observability total, not a per-drain delta.
      resultNotificationPublishFailed: {
        processTotal: workflowResultNotificationPublishFailures()
      }
    }
  }
})
