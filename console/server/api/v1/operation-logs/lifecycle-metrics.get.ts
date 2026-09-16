import { getConsoleLifecycleAuditMetrics } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  // Metrics expose the same lifecycle audit facts as the operation-log view.
  // Both exact, read-only grants are required before Tenant Runtime is called.
  await requirePermission(event, 'authorization_lifecycle', 'view', '需要授权生命周期查看权限')
  await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')

  return await getConsoleLifecycleAuditMetrics(event, getQuery(event))
})
