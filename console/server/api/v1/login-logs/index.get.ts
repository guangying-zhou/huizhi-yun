import { getConsoleLoginLogs } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')
  return await getConsoleLoginLogs(event, getQuery(event))
})
