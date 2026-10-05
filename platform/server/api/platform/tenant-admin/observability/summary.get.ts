import { ok, requireString } from '~~/server/utils/api'
import { requestObservability } from '~~/server/utils/observability'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode').trim()
  const appCode = String(query.appCode || '').trim()
  const hours = Math.min(168, Math.max(1, Number(query.hours || 24) || 24))

  const data = await requestObservability('/api/observability/summary', {
    query: {
      tenantCode,
      appCode,
      hours
    }
  })

  return ok(data)
})
