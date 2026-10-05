import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { updateDigitalAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'digital_assets', 'edit')

  const id = parseIdParam(event)
  const payload = await readRequestBody<Record<string, unknown>>(event)

  await updateDigitalAssetFromDb(id, payload, getOperatorUid(event))

  return ok({ id }, '数字资产已更新')
})
