import { assertFound, ok, parseIdParam } from '~~/server/utils/assetsApi'
import { getPurchaseOrderDetailFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'purchase_orders', 'view')

  const id = parseIdParam(event)
  const detail = await getPurchaseOrderDetailFromDb(id)

  return ok(assertFound(detail, '采购单不存在'))
})
