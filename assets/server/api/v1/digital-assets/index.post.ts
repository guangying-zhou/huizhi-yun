import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createDigitalAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'digital_assets', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createDigitalAssetFromDb(payload, getOperatorUid(event))

  return ok({ id }, '数字资产已创建')
})
