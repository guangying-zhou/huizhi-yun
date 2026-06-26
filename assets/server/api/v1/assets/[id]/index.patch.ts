import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { updateAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'asset_items', 'edit')

  const id = parseIdParam(event)
  const payload = await readRequestBody<Record<string, unknown>>(event)

  await updateAssetFromDb(id, payload, getOperatorUid(event))

  return ok({ id }, '资产已更新')
})
