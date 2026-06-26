import { ok } from '~~/server/utils/assetsApi'
import { getDashboardOverviewFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'dashboard', 'view')

  return ok(await getDashboardOverviewFromDb())
})
