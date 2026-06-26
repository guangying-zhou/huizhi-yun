import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface AnnotationParams {
  status: string
  resolved_by?: string
  deleted_by?: string
}

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event) as AnnotationParams

    if (!id) {
      throw createError({ statusCode: 400, message: 'Annotation ID is required' })
    }

    if (!body.status) {
      throw createError({ statusCode: 400, message: 'Status is required' })
    }

    const { status, resolved_by, deleted_by } = body
    const uuid = getRouterParam(event, 'uuid')
    await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(String(uuid || ''))}/annotations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      scope: 'codocs.write',
      body: { status, resolved_by, deleted_by }
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
