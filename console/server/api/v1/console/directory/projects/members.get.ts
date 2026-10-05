import { getConsoleDirectoryProjectMembers } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'view')

  const query = getQuery(event)
  const projectCode = String(query.projectCode || query.project_code || '').trim()
  if (!projectCode) throw createError({ statusCode: 400, message: 'projectCode is required' })

  return await getConsoleDirectoryProjectMembers(event, projectCode, query)
})
