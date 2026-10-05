import { getConsoleDirectoryUserDepartments } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')

  const query = getQuery(event)
  return await getConsoleDirectoryUserDepartments(event, query.uid ? String(query.uid) : undefined)
})
