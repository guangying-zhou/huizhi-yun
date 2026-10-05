import { ok } from '~~/server/utils/assetsApi'
import { listAssetCategories, normalizeAssetCategoryScope } from '~~/server/utils/assetCategoryRepository'

export default defineEventHandler(async (event) => {
  const items = await listAssetCategories(normalizeAssetCategoryScope(getQuery(event).scope))
  return ok({ items })
})
