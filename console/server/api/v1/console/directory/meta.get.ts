import { getConsoleDirectoryMeta } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'console_overview', 'view')
  return await getConsoleDirectoryMeta(event)
})
