import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { normalizeAssetCategoryScope, saveAssetCategory } from '~~/server/utils/assetCategoryRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const scope = normalizeAssetCategoryScope(payload.scope ?? getQuery(event).scope)
  const item = await saveAssetCategory(scope, null, payload, getOperatorUid(event))

  return ok(item, '资产类别已创建')
})
