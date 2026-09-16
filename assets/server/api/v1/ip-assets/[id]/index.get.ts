import { assertFound, ok, parseIdParam } from '~~/server/utils/assetsApi'
import { getIpAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'ip_assets', 'view')

  const id = parseIdParam(event)
  const asset = await getIpAssetFromDb(id)

  return ok(assertFound(asset, '知识产权资产不存在'))
})
