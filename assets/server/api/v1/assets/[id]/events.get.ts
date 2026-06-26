import { ok, parseIdParam } from '~~/server/utils/assetsApi'
import { listAssetEventsFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'asset_items', 'view')

  const id = parseIdParam(event)

  return ok(await listAssetEventsFromDb(id))
})
