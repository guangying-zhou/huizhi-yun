import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

interface AnnotationIndexPostBody {
  selected_text: string
  context_before?: string
  context_after?: string
  position_hint?: number
  content: string
  mentioned_users?: unknown[]
}

export default defineEventHandler(async (event) => {
  try {
    requireRequestUid(event)
    await requirePermission(event, 'documents', 'edit', '缺少文档批注编辑权限')
    const uuid = getRouterParam(event, 'uuid')
    const body = await readBody(event) as AnnotationIndexPostBody

    if (!uuid) {
      throw createError({ statusCode: 400, message: 'Document UUID is required' })
    }

    // Basic validation
    if (!body.content || !body.selected_text) {
      throw createError({ statusCode: 400, message: 'Missing required fields (content, selected_text)' })
    }

    const {
      selected_text, context_before, context_after, position_hint,
      content, mentioned_users
    } = body

    const result = await callCodocsTenantRuntime<{ id: number }>(event, `/v1/codocs/documents/${encodeURIComponent(uuid)}/annotations`, {
      method: 'POST',
      scope: 'codocs.write',
      body: {
        selected_text,
        context_before: context_before || '',
        context_after: context_after || '',
        position_hint: position_hint || 0,
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
    console.error('Failed to create annotation:', error)
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || 'Failed to create annotation'
    })
  }
})
