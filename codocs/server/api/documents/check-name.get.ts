/**
 * 检查文档名称是否冲突 API
 * GET /api/documents/check-name
 * Query: title, doc_type, owner_uid, folder_id, dept_code, project_code, exclude_uuid
 */

import { requireDepartmentReadAccess } from '~~/server/utils/departmentAccess'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const { title, doc_type, owner_uid, folder_id, dept_code, project_code, exclude_uuid } = query
    const actorUid = getRequestUid(event)

    if (!title) {
      return { success: true, data: { exists: false } }
    }

    if ((doc_type === 'department' || dept_code) && dept_code) {
      await requireDepartmentReadAccess(actorUid, String(dept_code))
    }

    const data = await callCodocsTenantRuntime<{ exists: boolean }>(event, '/v1/codocs/documents/check-name', {
      query: {
        title,
        doc_type,
        owner_uid,
        folder_id,
        dept_code,
        project_code,
        exclude_uuid
      },
      scope: 'codocs.read'
    })

    return {
      success: true,
      data
    }
  } catch (error: unknown) {
    console.error('Failed to check document name:', error)
    throw createError({
      statusCode: 500,
      message: '检查文档名称失败'
    })
  }
})
