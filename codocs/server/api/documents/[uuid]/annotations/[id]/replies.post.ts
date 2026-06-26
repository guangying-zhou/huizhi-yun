import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface RepliesPostBody {
  content: string
  mentioned_users?: unknown[]
  author_id: string
  author_name?: string
}

export default defineEventHandler(async (event) => {
  try {
    const annotationId = getRouterParam(event, 'id')
    const body = await readBody(event) as RepliesPostBody

    if (!annotationId) {
      throw createError({ statusCode: 400, message: 'Annotation ID is required' })
    }

    if (!body.content || !body.author_id) {
      throw createError({ statusCode: 400, message: 'Content and Author ID are required' })
    }

    const { content, mentioned_users, author_id, author_name } = body
    const uuid = getRouterParam(event, 'uuid')
    const result = await callCodocsTenantRuntime<{ id: number }>(event, `/v1/codocs/documents/${encodeURIComponent(String(uuid || ''))}/annotations/${encodeURIComponent(annotationId)}/replies`, {
      method: 'POST',
      scope: 'codocs.write',
      body: {
        content,
        mentioned_users: mentioned_users || [],
        author_id,
        author_name: author_name || 'Unknown'
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
