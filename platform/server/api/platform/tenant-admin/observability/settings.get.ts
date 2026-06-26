import { ok, requireString } from '~~/server/utils/api'
import { requestObservability } from '~~/server/utils/observability'

export default defineEventHandler(async (event) => {
  const tenantCode = requireString(getQuery(event).tenantCode, 'tenantCode').trim()

  const data = await requestObservability('/api/observability/settings', {
    query: {
      tenantCode
    }
  })

  return ok(data)
})
