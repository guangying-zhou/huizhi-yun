import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')
    if (!uuid) {
      throw createError({ statusCode: 400, message: 'Document UUID is required' })
    }

    const result = await callCodocsTenantRuntime<unknown[]>(event, `/v1/codocs/documents/${encodeURIComponent(uuid)}/annotations`, {
      scope: 'codocs.read'
    })

    return {
      success: true,
      data: result
    }
  } catch (error: unknown) {
    console.error('Failed to get annotations:', error)
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'Failed to get annotations'
    throw createError({
      statusCode,
      message
    })
  }
})
