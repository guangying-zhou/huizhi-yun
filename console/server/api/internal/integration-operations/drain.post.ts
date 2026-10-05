import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { drainPlatformLifecycleActionablesForEvent } from '~~/server/utils/platformLifecycleActionableDrain'
import { drainPlatformLifecycleOperationsForEvent } from '~~/server/utils/platformLifecycleOperation'

export default defineEventHandler(async (event) => {
  await requireTenantGatewaySchedulerRequest(event, 'console')
  const result = await drainPlatformLifecycleOperationsForEvent(event, {
    maxClaims: 10,
    maxDurationMs: 25_000,
    claimReserveMs: 12_000
  })
  const actionables = result.claimed > 0
    ? { skipped: true, reason: 'operation_drain_precedes_actionables' }
    : await drainPlatformLifecycleActionablesForEvent(event, { limit: 1 })
  return { code: 0, data: { result, actionables } }
})
