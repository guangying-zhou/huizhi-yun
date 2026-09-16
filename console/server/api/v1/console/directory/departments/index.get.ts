import { getConsoleDirectoryDepartments } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'view')
  return await getConsoleDirectoryDepartments(event, getQuery(event))
})
