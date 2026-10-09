import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  try {
    requireRequestUid(event)
    await requirePermission(event, 'documents', 'edit', '缺少文档批注编辑权限')
    const replyId = getRouterParam(event, 'replyId')

    if (!replyId) {
      throw createError({ statusCode: 400, message: 'Reply ID is required' })
    }

    const uuid = getRouterParam(event, 'uuid')
    const annotationId = getRouterParam(event, 'id')
    await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(String(uuid || ''))}/annotations/${encodeURIComponent(String(annotationId || ''))}/replies/${encodeURIComponent(replyId)}`, {
      method: 'DELETE',
      scope: 'codocs.write'
    })

    return {
      success: true
    }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    console.error('Failed to delete reply:', error)
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || 'Failed to delete reply'
    })
  }
})
