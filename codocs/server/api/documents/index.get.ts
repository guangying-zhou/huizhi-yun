/**
 * 获取文档列表 API
 * GET /api/documents
 */

import { requireDepartmentReadAccess } from '../../utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { withTrustedCodocsDocumentReadContext } from '~~/server/utils/documentReadScope'

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
    const actorUid = requireRequestUid(event)
    await requirePermission(event, 'documents', 'view', '缺少文档查看权限')

    if (type === 'department' && !dept_code) {
      throw createError({
        statusCode: 400,
        message: '部门文档查询必须指定 dept_code'
      })
    }

    if (dept_code) {
      await requireDepartmentReadAccess(event, actorUid, String(dept_code))
    }

    const runtimeQuery = withTrustedCodocsDocumentReadContext(query, actorUid, dept_code ? String(dept_code) : '')
    const page = await callCodocsTenantRuntime<RuntimePage>(event, '/v1/codocs/documents', {
      query: runtimeQuery,
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
    const error = err as { statusCode?: unknown }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600) {
      throw err
    }
    throw createError({
      statusCode: 500,
      message: '获取文档列表失败'
    })
  }
})
