import { getQuery } from 'h3'
import { ok } from '~~/server/utils/assetsApi'
import { listDigitalAssetsFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'digital_assets', 'view')

  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search : undefined
  const status = typeof query.status === 'string' ? query.status : undefined

  return ok(await listDigitalAssetsFromDb({ search, status }))
})
