import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

interface RepliesPostBody {
  content: string
  mentioned_users?: unknown[]
}

export default defineEventHandler(async (event) => {
  try {
    requireRequestUid(event)
    await requirePermission(event, 'documents', 'edit', '缺少文档批注编辑权限')
    const annotationId = getRouterParam(event, 'id')
    const body = await readBody(event) as RepliesPostBody

    if (!annotationId) {
      throw createError({ statusCode: 400, message: 'Annotation ID is required' })
    }

    if (!body.content) {
      throw createError({ statusCode: 400, message: 'Content is required' })
    }

    const { content, mentioned_users } = body
    const uuid = getRouterParam(event, 'uuid')
    const result = await callCodocsTenantRuntime<{ id: number }>(event, `/v1/codocs/documents/${encodeURIComponent(String(uuid || ''))}/annotations/${encodeURIComponent(annotationId)}/replies`, {
      method: 'POST',
      scope: 'codocs.write',
      body: {
        content,
        mentioned_users: mentioned_users || []
      }
    })

    return {
      success: true,
      data: {
        id: result.id
      }
    }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    console.error('Failed to add reply:', error)
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || 'Failed to add reply'
    })
  }
})
