/**
 * 获取文档列表 API
 * GET /api/documents
 */

import { requireDepartmentReadAccess } from '../../utils/departmentAccess'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface RuntimePage {
  items?: unknown[]
  total?: number
  page?: number
  pageSize?: number
  limit?: number
}

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const { type, dept_code } = query
    const actorUid = getRequestUid(event)

    if (type === 'department' && !dept_code) {
      throw createError({
        statusCode: 400,
        message: '部门文档查询必须指定 dept_code'
      })
    }

    if (dept_code) {
      await requireDepartmentReadAccess(actorUid, String(dept_code))
    }

    const page = await callCodocsTenantRuntime<RuntimePage>(event, '/v1/codocs/documents', {
      query,
      scope: 'codocs.read'
    })

    return {
      success: true,
      data: {
        items: page.items || [],
        total: Number(page.total || 0),
        page: Number(page.page || 1),
        limit: Number(page.limit || page.pageSize || query.limit || 5000)
      }
    }
  } catch (err: unknown) {
    console.error('Failed to fetch documents:', err)
    throw createError({
      statusCode: 500,
      message: '获取文档列表失败'
    })
  }
})
