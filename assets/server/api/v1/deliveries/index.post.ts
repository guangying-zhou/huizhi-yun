import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createDeliveryFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'deliveries', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createDeliveryFromDb(payload, getOperatorUid(event))

  return ok({ id }, '交付视图已创建')
})
