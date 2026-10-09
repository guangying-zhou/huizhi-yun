import { getOperatorUid, ok, parseIdParam, readRequestBody } from '~~/server/utils/assetsApi'
import { createReceiptFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'receipts', 'edit')

  const id = parseIdParam(event)
  const payload = await readRequestBody<Record<string, unknown>>(event)

  const receiptId = await createReceiptFromDb(id, payload, getOperatorUid(event))

  return ok({ id, receipt_id: receiptId }, '入库/激活记录已创建')
})
