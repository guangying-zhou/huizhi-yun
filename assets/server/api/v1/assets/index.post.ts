import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'asset_items', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const asset = await createAssetFromDb(payload, getOperatorUid(event))

  return ok(asset, '资产已创建')
})
