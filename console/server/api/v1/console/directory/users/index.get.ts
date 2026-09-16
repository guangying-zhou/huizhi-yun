import { getConsoleDirectoryUsers } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')
  return await getConsoleDirectoryUsers(event, getQuery(event))
})
