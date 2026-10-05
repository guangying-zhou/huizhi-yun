import { getRouterParam } from 'h3'
import { projectIntegrationOperationAttempts } from '@hzy/foundation/server/utils/integrationOperationDiagnosticProjection'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callAimsIntegrationOperationAdmin } from '~~/server/utils/integrationOperationAdmin'

export default defineEventHandler(async (event) => {
  if (!getRequestUid(event)) throw createError({ statusCode: 401, message: '请先登录' })
  await requirePermission(event, 'integration_operations', 'view', '需要跨应用操作诊断权限')
  const operationId = String(getRouterParam(event, 'operationId') || '').trim()
  if (!operationId) throw createError({ statusCode: 400, message: 'operationId 必填' })
  const data = await callAimsIntegrationOperationAdmin<Record<string, unknown>>(
    event,
    `/v1/aims/integration-operations/${encodeURIComponent(operationId)}/attempts`,
    'view',
    { query: { limit: 100 } }
  )
  return { code: 0, data: projectIntegrationOperationAttempts(data) }
})
