import { ok } from '~~/server/utils/assetsApi'
import { listReceiptsFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'receipts', 'view')

  return ok(await listReceiptsFromDb())
})
