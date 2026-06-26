/**
 * 获取 Issue 列表
 * GET /api/issues?project_code=xxx&status=open&type=bug&assignee=xxx&search=xxx&page=1&limit=20
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface IssuePage {
  items?: unknown[]
  total?: number
  page?: number
  pageSize?: number
  limit?: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  try {
    const page = await callCodocsTenantRuntime<IssuePage>(event, '/v1/codocs/issues', {
      query,
      scope: 'codocs.read'
    })

    return {
      success: true,
      data: {
        items: page.items || [],
        total: Number(page.total || 0),
        page: Number(page.page || 1),
        limit: Number(page.limit || page.pageSize || query.limit || 20)
      }
    }
  } catch (error: unknown) {
    console.error('Failed to fetch issues:', error)
    throw createError({ statusCode: 500, message: '获取Issue列表失败' })
  }
})
