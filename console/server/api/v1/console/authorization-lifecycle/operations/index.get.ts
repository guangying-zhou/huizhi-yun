import { getQuery } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { listPlatformLifecycleOperations } from '~~/server/utils/platformLifecycleDiagnostics'

export default defineEventHandler(async (event) => {
  // Both grants protect this operational view. Check them before resolving the
  // tenant-bound outbox or issuing any diagnostic query.
  await requirePermission(event, 'authorization_lifecycle', 'view', '需要授权生命周期查看权限')
  await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')

  const query = getQuery(event)
  const items = await listPlatformLifecycleOperations({
    event,
    uid: query.uid,
    limit: query.limit
  })
  return { code: 0, message: 'success', data: { items } }
})
