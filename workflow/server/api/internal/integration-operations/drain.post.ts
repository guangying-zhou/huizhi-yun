import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import {
  drainWorkflowActionableLifecycleOutbox,
  drainWorkflowCallbackOutbox
} from '~~/server/utils/dataRuntime'

export default defineEventHandler(async (event) => {
  await requireTenantGatewaySchedulerRequest(event, 'workflow')
  const actionableLifecycles = await drainWorkflowActionableLifecycleOutbox(event)
  const callbacks = await drainWorkflowCallbackOutbox(event)
  return {
    code: 0,
    data: {
      processed: callbacks.length,
      delivered: callbacks.filter(item => item.status === 'delivered').length,
      failed: callbacks.filter(item => item.status === 'failed').length,
      actionable: {
        processed: actionableLifecycles.length,
        delivered: actionableLifecycles.filter(item => item.status === 'delivered').length,
        pending: actionableLifecycles.filter(item => item.status === 'pending').length,
        invalid: actionableLifecycles.filter(item => item.status === 'invalid').length
      }
    }
  }
})
