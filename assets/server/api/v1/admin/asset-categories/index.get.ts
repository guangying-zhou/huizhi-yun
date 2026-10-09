import { ok } from '~~/server/utils/assetsApi'
import { listAssetCategories, normalizeAssetCategoryScope } from '~~/server/utils/assetCategoryRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin')

  const scope = normalizeAssetCategoryScope(getQuery(event).scope)
  const items = await listAssetCategories(scope, true)
  return ok({ items })
})
