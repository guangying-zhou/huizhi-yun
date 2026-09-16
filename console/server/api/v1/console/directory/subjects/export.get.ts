import { getConsoleDirectorySubjectExports } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'export', '需要目录主体导出权限')
  return await getConsoleDirectorySubjectExports(event, getQuery(event))
})
