import { getQuery } from 'h3'
import { projectIntegrationOperationList } from '@hzy/foundation/server/utils/integrationOperationDiagnosticProjection'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callAltocIntegrationOperationAdmin } from '~~/server/utils/integrationOperationAdmin'

export default defineEventHandler(async (event) => {
  if (!getRequestUid(event)) throw createError({ statusCode: 401, message: '请先登录' })
  await requirePermission(event, 'integration_operations', 'view', '需要跨应用操作诊断权限')
  const source = getQuery(event)
  const query: Record<string, unknown> = {}
  for (const key of ['status', 'limit', 'cursor']) {
    if (source[key] !== undefined) query[key] = source[key]
  }
  const data = await callAltocIntegrationOperationAdmin<Record<string, unknown>>(
    event,
    '/v1/altoc/integration-operations',
    'view',
    { query }
  )
  return { code: 0, data: projectIntegrationOperationList(data) }
})
