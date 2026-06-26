import { getQuery } from 'h3'
import { ok } from '~~/server/utils/assetsApi'
import { listAssetsFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'asset_items', 'view')

  const query = getQuery(event)
  const category = typeof query.category === 'string' ? query.category : undefined
  const search = typeof query.search === 'string' ? query.search : undefined
  const status = typeof query.status === 'string' ? query.status : undefined

  return ok(await listAssetsFromDb(category, { search, status }))
})
