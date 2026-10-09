import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { changeAssetStatusFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'asset_items', 'edit')

  const id = parseIdParam(event)
  const payload = await readRequestBody<{ status?: string }>(event)

  if (!payload.status) {
    throw createError({ statusCode: 400, message: '缺少 status' })
  }

  await changeAssetStatusFromDb(id, payload.status, getOperatorUid(event))

  return ok({ id, status: payload.status }, '资产状态已更新')
})
