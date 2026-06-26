/**
 * 删除 Issue
 * DELETE /api/issues/:id
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少Issue ID' })
  }

  try {
    await callCodocsTenantRuntime(event, `/v1/codocs/issues/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      scope: 'codocs.write'
    })
    return { success: true, message: '删除成功' }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      throw error
    }
    console.error('Failed to delete issue:', error)
    throw createError({ statusCode: 500, message: '删除Issue失败' })
  }
})
