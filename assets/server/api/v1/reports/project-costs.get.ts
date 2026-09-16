import { ok } from '~~/server/utils/assetsApi'
import { getReportsFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'reports', 'view')

  return ok((await getReportsFromDb()).project_costs)
})
