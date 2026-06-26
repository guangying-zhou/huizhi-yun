/**
 * 获取 Issue 详情（含评论）
 * GET /api/issues/:id
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少Issue ID' })
  }

  try {
    const issue = await callCodocsTenantRuntime<Record<string, unknown>>(event, `/v1/codocs/issues/${encodeURIComponent(id)}`, {
      scope: 'codocs.read'
    })

    return {
      success: true,
      data: issue
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      throw error
    }
    console.error('Failed to fetch issue:', error)
    throw createError({ statusCode: 500, message: '获取Issue详情失败' })
  }
})
