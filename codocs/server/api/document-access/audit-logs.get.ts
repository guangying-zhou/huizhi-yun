import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  await requirePermission(event, 'documents', 'admin', '仅文档空间管理员可查看访问审计')
  const query = getQuery(event)
  const result = await callCodocsTenantRuntime<Record<string, unknown>>(
    event,
    '/v1/codocs/document-access/audit-logs',
    {
      scope: 'codocs.read',
      query
    }
  )

  return {
    code: 0,
    data: result
  }
})
