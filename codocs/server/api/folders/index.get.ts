/**
 * 获取文件夹列表 API
 * GET /api/folders
 */

import { requireDepartmentReadAccess } from '../../utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'
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
    const { folder_type, dept_code } = query
    const actorUid = requireRequestUid(event)
    await requirePermission(event, 'documents', 'view', '缺少文档目录查看权限')

    if (folder_type === 'department' && !dept_code) {
      throw createError({
        statusCode: 400,
        message: '部门文件夹查询必须指定 dept_code'
      })
    }

    if (dept_code) {
      await requireDepartmentReadAccess(event, actorUid, String(dept_code))
    }

    const runtimeQuery = withTrustedCodocsDocumentReadContext(query, actorUid, String(dept_code || '').trim())
    const page = await callCodocsTenantRuntime<RuntimePage>(event, '/v1/codocs/folders', {
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
  } catch (error: unknown) {
    console.error('Failed to fetch folders:', error)
    throw createError({
      statusCode: 500,
      message: '获取文件夹列表失败'
    })
  }
})
