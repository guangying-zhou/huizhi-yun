import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import {
  drainWorkflowActionableLifecycleOutbox,
  drainWorkflowCallbackOutbox,
  drainWorkflowNotificationOutbox
} from '~~/server/utils/dataRuntime'

export default defineEventHandler(async (event) => {
  await requireTenantGatewaySchedulerRequest(event, 'workflow')
  // Creation notifications first: the Runtime holds a lifecycle CAS back until
  // the projection it closes has been created.
  const notifications = await drainWorkflowNotificationOutbox(event)
  const actionableLifecycles = await drainWorkflowActionableLifecycleOutbox(event)
  const callbacks = await drainWorkflowCallbackOutbox(event)
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
      }
    }
  }
})
