import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { drainIntegrationOperationsForEvent } from '~~/server/utils/integrationOperationDrain'

export default defineEventHandler(async (event) => {
  const binding = await requireTenantGatewaySchedulerRequest(event, 'altoc')
  const result = await drainIntegrationOperationsForEvent(event, binding, {
    maxClaims: 10,
    maxWallTimeMs: 25_000,
    claimReserveMs: 12_000
  })
  return { code: 0, data: result }
})
