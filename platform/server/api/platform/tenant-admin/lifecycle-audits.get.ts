import { getQuery } from 'h3'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'
import { listPeopleLifecycleAudits } from '~~/server/utils/peopleLifecycleAudits'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const { page, pageSize, offset } = parsePagination(query)

  return ok(await listPeopleLifecycleAudits(
    { queryRow, queryRows },
    {
      tenantCode,
      page,
      pageSize,
      offset,
      uid: normalizeNullableString(query.uid),
      action: normalizeNullableString(query.action),
      source: normalizeNullableString(query.source),
      keyword: normalizeNullableString(query.keyword)
    }
  ))
})
