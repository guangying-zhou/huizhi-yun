/**
 * 更新文件夹 API
 * PATCH /api/folders/:id
 */

import { requireDepartmentManagerAccess } from '../../utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface FolderRow {
  id: number
  name: string
  folder_type: string
  owner_uid: string | null
  dept_code: string | null
  project_code: string | null
  parent_id: number | null
}

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)

    if (!id) {
      throw createError({
        statusCode: 400,
        message: '文件夹ID不能为空'
      })
    }

    const actorUid = requireRequestUid(event)

    const oldFolder = await callCodocsTenantRuntime<FolderRow>(event, `/v1/codocs/folders/${encodeURIComponent(id)}`, {
      scope: 'codocs.read'
    })

    if (oldFolder.folder_type === 'department' && oldFolder.dept_code) {
      await requireDepartmentManagerAccess(actorUid, oldFolder.dept_code, '仅部门经理可修改目录')
    }

    const updates: Record<string, unknown> = {}

    if (body.name !== undefined) {
      updates.name = body.name
    }

    if (body.parent_id !== undefined) {
      updates.parent_id = body.parent_id || null
    }

    if (Object.keys(updates).length === 0) {
      throw createError({
        statusCode: 400,
        message: '没有要更新的字段'
      })
    }

    await callCodocsTenantRuntime(event, `/v1/codocs/folders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      scope: 'codocs.write',
      body: updates
    })

    return {
      success: true,
      data: { id: Number(id), updated: true }
    }
  } catch (error: unknown) {
    console.error('Failed to update folder:', error)
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '更新文件夹失败'
    throw createError({
      statusCode,
      message
    })
  }
})
