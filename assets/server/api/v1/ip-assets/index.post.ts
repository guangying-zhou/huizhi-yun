import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createIpAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'ip_assets', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createIpAssetFromDb(payload, getOperatorUid(event))

  return ok({ id }, '知识产权资产已创建')
})
