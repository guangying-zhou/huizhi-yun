import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { updateDeliveryFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'deliveries', 'edit')

  const id = parseIdParam(event)
  const payload = await readRequestBody<Record<string, unknown>>(event)

  await updateDeliveryFromDb(id, payload, getOperatorUid(event))

  return ok({ id }, '交付视图已更新')
})
