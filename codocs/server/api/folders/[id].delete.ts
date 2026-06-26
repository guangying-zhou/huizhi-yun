/**
 * 删除文件夹 API
 * DELETE /api/folders/:id
 */

import { requireDepartmentManagerAccess } from '../../utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface FolderRow {
  folder_type: string
  dept_code: string | null
}

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')

    if (!id) {
      throw createError({
        statusCode: 400,
        message: '文件夹ID不能为空'
      })
    }

    const actorUid = requireRequestUid(event)

    const folder = await callCodocsTenantRuntime<FolderRow>(event, `/v1/codocs/folders/${encodeURIComponent(id)}`, {
      scope: 'codocs.read'
    })
    if (folder.folder_type === 'department' && folder.dept_code) {
      await requireDepartmentManagerAccess(actorUid, folder.dept_code, '仅部门经理可删除目录')
    }

    // Check if folder has children
    const children = await callCodocsTenantRuntime<{ items?: unknown[] }>(event, '/v1/codocs/folders', {
      query: { parent_id: id },
      scope: 'codocs.read'
    })
    if ((children.items || []).length > 0) {
      throw createError({
        statusCode: 400,
        message: '文件夹不为空，请先删除子文件夹'
      })
    }

    // Check if folder has documents
    const docs = await callCodocsTenantRuntime<{ items?: unknown[] }>(event, '/v1/codocs/documents', {
      query: { folder_id: id },
      scope: 'codocs.read'
    })
    if ((docs.items || []).length > 0) {
      throw createError({
        statusCode: 400,
        message: '文件夹不为空，请先删除或移动文档'
      })
    }

    await callCodocsTenantRuntime(event, `/v1/codocs/folders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      scope: 'codocs.write'
    })

    return {
      success: true,
      data: { id: Number(id), deleted: true }
    }
  } catch (error: unknown) {
    console.error('Failed to delete folder:', error)
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '删除文件夹失败'
    throw createError({
      statusCode,
      message
    })
  }
})
