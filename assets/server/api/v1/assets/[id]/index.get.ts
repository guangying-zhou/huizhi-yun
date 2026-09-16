import { assertFound, ok } from '~~/server/utils/assetsApi'
import { getAssetDetailFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'asset_items', 'view')

  const identifier = String(event.context.params?.id || '').trim()
  if (!identifier) {
    throw createError({
      statusCode: 400,
      message: '无效的 id'
    })
  }

  const asset = await getAssetDetailFromDb(identifier)

  return ok(assertFound(asset, '资产不存在'))
})
