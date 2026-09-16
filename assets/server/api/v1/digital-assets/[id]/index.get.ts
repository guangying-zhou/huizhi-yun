import { assertFound, ok, parseIdParam } from '~~/server/utils/assetsApi'
import { getDigitalAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'digital_assets', 'view')

  const id = parseIdParam(event)
  const asset = await getDigitalAssetFromDb(id)

  return ok(assertFound(asset, '数字资产不存在'))
})
