import { ok, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'
import { mapReleaseRow, queryAppReleaseRows } from '~~/server/utils/appReleases'

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')
  const items = await queryAppReleaseRows({ queryRows, queryRow }, appCode)

  return ok({
    items: items.map(mapReleaseRow)
  })
})
