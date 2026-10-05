import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createPurchaseOrderFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'purchase_orders', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createPurchaseOrderFromDb(payload, getOperatorUid(event))

  return ok({ id }, '采购单已创建')
})
