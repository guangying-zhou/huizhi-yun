import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { bindEnvironmentAssetFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'environments', 'edit')

  const id = parseIdParam(event)
  const payload = await readRequestBody<Record<string, unknown>>(event)

  await bindEnvironmentAssetFromDb(id, payload, getOperatorUid(event))

  return ok({ id }, '环境资产关联已创建')
})
