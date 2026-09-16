import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { drainDirectoryLifecycleOperationsForEvent } from '~~/server/utils/directoryLifecycleOperation'

export default defineEventHandler(async (event) => {
  const binding = await requireTenantGatewaySchedulerRequest(event, 'people')
  const result = await drainDirectoryLifecycleOperationsForEvent(event, binding, {
    maxClaims: 10,
    maxDurationMs: 25_000,
    claimReserveMs: 12_000
  })
  return { code: 0, data: result }
})
