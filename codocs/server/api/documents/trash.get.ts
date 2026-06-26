/**
 * 获取回收站文档列表 API
 * GET /api/documents/trash
 * Query: type (private/project/department), owner, dept_code, project_code
 */

import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const { type, owner, dept_code, project_code } = query

    const data = await callCodocsTenantRuntime<{ items: unknown[] }>(event, '/v1/codocs/documents/trash', {
      query: {
        type,
        owner,
        dept_code,
        project_code
      },
      scope: 'codocs.read'
    })

    return {
      success: true,
      data: { items: data.items || [] }
    }
  } catch (err: unknown) {
    console.error('Failed to fetch trash documents:', err)
    throw createError({
      statusCode: 500,
      message: '获取回收站文档列表失败'
    })
  }
})
