/**
 * 获取回收站文档列表 API
 * GET /api/documents/trash
 * Query: type (private/project/department), owner, dept_code, project_code
 */

import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireDepartmentReadAccess } from '~~/server/utils/departmentAccess'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { withTrustedCodocsDocumentReadContext } from '~~/server/utils/documentReadScope'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const { type, owner, dept_code, project_code } = query
    const actorUid = requireRequestUid(event)
    await requirePermission(event, 'documents', 'view', '缺少文档查看权限')

    if (type === 'department' && !dept_code) {
      throw createError({ statusCode: 400, message: '部门文档查询必须指定 dept_code' })
    }
    if (dept_code) {
      await requireDepartmentReadAccess(event, actorUid, String(dept_code))
    }

    const runtimeQuery = withTrustedCodocsDocumentReadContext(
      { type, owner, dept_code, project_code },
      actorUid,
      dept_code ? String(dept_code) : ''
    )

    const data = await callCodocsTenantRuntime<{ items: unknown[] }>(event, '/v1/codocs/documents/trash', {
      query: runtimeQuery,
      scope: 'codocs.read'
    })

    return {
      success: true,
      data: { items: data.items || [] }
    }
  } catch (err: unknown) {
    console.error('Failed to fetch trash documents:', err)
    const error = err as { statusCode?: unknown }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600) {
      throw err
    }
    throw createError({
      statusCode: 500,
      message: '获取回收站文档列表失败'
    })
  }
})
