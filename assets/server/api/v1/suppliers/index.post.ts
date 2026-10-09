import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createSupplierFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'suppliers', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createSupplierFromDb(payload, getOperatorUid(event))

  return ok({ id }, '供应商已创建')
})
