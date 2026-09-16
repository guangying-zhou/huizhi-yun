import { getConsoleBusinessDomains } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'org_profile', 'view')
  return await getConsoleBusinessDomains(event, getQuery(event))
})
