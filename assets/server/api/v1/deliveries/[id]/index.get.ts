import { assertFound, ok, parseIdParam } from '~~/server/utils/assetsApi'
import { getDeliveryFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'deliveries', 'view')

  const id = parseIdParam(event)
  const delivery = await getDeliveryFromDb(id)

  return ok(assertFound(delivery, '交付视图不存在'))
})
