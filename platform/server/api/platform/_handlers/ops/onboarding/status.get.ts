import { ok, requireString } from '~~/server/utils/api'
import { loadOnboardingStatus } from '~~/server/utils/onboardingFlow'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const result = await loadOnboardingStatus(tenantCode, query.environment)

  return ok(result)
})
