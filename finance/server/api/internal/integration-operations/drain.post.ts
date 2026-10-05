import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { drainFinanceIntegrationOperationsForEvent } from '~~/server/utils/altocFinanceSummaryOperation'

export default defineEventHandler(async (event) => {
  const binding = await requireTenantGatewaySchedulerRequest(event, 'finance')
  const result = await drainFinanceIntegrationOperationsForEvent(event, binding, {
    maxClaims: 10,
    maxWallTimeMs: 25_000,
    claimReserveMs: 12_000
  })
  return { code: 0, data: result }
})
