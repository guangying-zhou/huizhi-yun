import { getConsoleDirectoryProjects } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'view')
  return await getConsoleDirectoryProjects(event, getQuery(event))
})
