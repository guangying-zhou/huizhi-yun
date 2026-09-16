import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { listSubscriptions } from '~~/server/utils/subscriptions'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const keyword = normalizeNullableString(query.keyword)
  const appType = normalizeNullableString(query.appType)
  const status = normalizeNullableString(query.status)
  const planScoped = normalizeNullableString(query.planScoped) === 'true'
  const { page, pageSize } = parsePagination(query)

  const result = await listSubscriptions(tenantCode, {
    keyword,
    appType,
    status,
    planScoped,
    page,
    pageSize
  })

  return ok(result)
})
