import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { createPurchaseOrderItemFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'purchase_orders', 'edit')

  const id = parseIdParam(event)
  const payload = await readRequestBody<Record<string, unknown>>(event)

  const itemId = await createPurchaseOrderItemFromDb(id, payload, getOperatorUid(event))

  return ok({ id: itemId }, '采购明细已新增')
})
