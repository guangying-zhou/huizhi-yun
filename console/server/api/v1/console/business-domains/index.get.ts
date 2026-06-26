import { listBusinessDomains } from '~~/server/utils/businessDomains'
import { requirePermission } from '~~/server/utils/checkPermission'
import { ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'org_profile', 'view')
  return ok(await listBusinessDomains(getQuery(event)))
})
