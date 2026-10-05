import { createError, getRouterParam } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import {
  listPlatformLifecycleAttempts,
  parsePlatformLifecycleDiagnosticOperationId
} from '~~/server/utils/platformLifecycleDiagnostics'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'authorization_lifecycle', 'view', '需要授权生命周期查看权限')
  await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')

  const operationId = parsePlatformLifecycleDiagnosticOperationId(getRouterParam(event, 'operationId'))
  if (!operationId) throw createError({ statusCode: 400, message: 'invalid lifecycle operation id' })

  const items = await listPlatformLifecycleAttempts({ event, operationId })
  return { code: 0, message: 'success', data: { operationId, items: items || [] } }
})
