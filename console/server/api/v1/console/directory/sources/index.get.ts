import { requirePermission } from '~~/server/utils/checkPermission'
import { getConsoleDirectorySources } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sources', 'view')
  return await getConsoleDirectorySources(event)
})
