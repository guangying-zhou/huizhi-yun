import { listLegacyRuntimeCompanies } from '~~/server/utils/companyRuntimeCompat'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'org_profile', 'view')
  return {
    code: 0,
    data: await listLegacyRuntimeCompanies(event, getQuery(event))
  }
})
