import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { getAssetCategoryScopeById, normalizeAssetCategoryScope, saveAssetCategory } from '~~/server/utils/assetCategoryRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin')

  const id = parseIdParam(event)
  const payload = await readRequestBody<Record<string, unknown>>(event)
  const scope = payload.scope != null || getQuery(event).scope != null
    ? normalizeAssetCategoryScope(payload.scope ?? getQuery(event).scope)
    : await getAssetCategoryScopeById(id)
  const item = await saveAssetCategory(scope, id, payload, getOperatorUid(event))

  return ok(item, '资产类别已更新')
})
