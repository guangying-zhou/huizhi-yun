import { requirePermission } from '~~/server/utils/checkPermission'
import { getConsoleDirectoryProvisioning } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')
  return await getConsoleDirectoryProvisioning(event)
})
