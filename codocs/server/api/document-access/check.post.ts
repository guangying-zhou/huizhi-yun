import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  await requirePermission(event, 'documents', 'view', '缺少文档访问校验权限')
  const body = await readBody<Record<string, unknown>>(event)
  const result = await callCodocsTenantRuntime<Record<string, unknown>>(
    event,
    '/v1/codocs/document-access/check',
    {
      method: 'POST',
      scope: 'codocs.read',
      body
    }
  )

  return {
    code: 0,
    data: result
  }
})
