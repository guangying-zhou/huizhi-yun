import { assertFound, ok, parseIdParam } from '~~/server/utils/assetsApi'
import { getProductAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'products', 'view')

  const id = parseIdParam(event)
  const product = await getProductAssetFromDb(id)

  return ok(assertFound(product, '产品主档不存在'))
})
