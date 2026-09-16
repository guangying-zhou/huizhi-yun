import { listOnlineHeartbeats } from '~~/server/utils/runtimeCompat'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')

  const { sourceApp } = getQuery(event) as { sourceApp?: string }
  return { success: true, data: await listOnlineHeartbeats(event, sourceApp) }
})
