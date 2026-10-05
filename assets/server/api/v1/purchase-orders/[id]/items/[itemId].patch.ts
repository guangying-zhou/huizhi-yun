import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { updatePurchaseOrderItemFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'purchase_orders', 'edit')

  const id = parseIdParam(event)
  const itemId = parseIdParam(event, 'itemId')
  const payload = await readRequestBody<Record<string, unknown>>(event)

  await updatePurchaseOrderItemFromDb(id, itemId, payload, getOperatorUid(event))

  return ok({ id: itemId }, '采购明细已更新')
})
