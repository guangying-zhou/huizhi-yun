import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createProductAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'products', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createProductAssetFromDb(payload, getOperatorUid(event))

  return ok({ id }, '产品主档已创建')
})
