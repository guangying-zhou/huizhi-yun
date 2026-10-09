import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, 'uuid')
  requireRequestUid(event)
  await requirePermission(event, 'documents', 'view', '缺少文档阅读权限')

  if (!uuid) {
    throw createError({ statusCode: 400, message: 'Missing params' })
  }

  await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(uuid)}/read`, {
    method: 'POST',
    scope: 'codocs.write',
    body: {}
  })

  return { success: true }
})
