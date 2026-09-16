import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

interface AnnotationParams {
  status: string
}

export default defineEventHandler(async (event) => {
  try {
    requireRequestUid(event)
    await requirePermission(event, 'documents', 'edit', '缺少文档批注编辑权限')
    const id = getRouterParam(event, 'id')
    const body = await readBody(event) as AnnotationParams

    if (!id) {
      throw createError({ statusCode: 400, message: 'Annotation ID is required' })
    }

    if (!body.status) {
      throw createError({ statusCode: 400, message: 'Status is required' })
    }

    const { status } = body
    const uuid = getRouterParam(event, 'uuid')
    await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(String(uuid || ''))}/annotations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      scope: 'codocs.write',
      body: { status }
    })

    return {
      success: true
    }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    console.error('Failed to update annotation:', error)
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || 'Failed to update annotation'
    })
  }
})
