/**
 * 创建文件夹 API
 * POST /api/folders
 */

import { requireDepartmentManagerAccess } from '../../utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

const TRUSTED_DEPARTMENT_MANAGER_QUERY_KEY = 'codocs_trusted_department_manage_dept_code'

function folderMutationRuntimeQuery(folderType: string, deptCode: string) {
  if (folderType === 'department') {
    return { [TRUSTED_DEPARTMENT_MANAGER_QUERY_KEY]: deptCode }
  }
  return undefined
}

export default defineEventHandler(async (event) => {
  try {
    const operatorUid = requireRequestUid(event)
    await requirePermission(event, 'documents', 'create', '缺少文档目录创建权限')
    const body = await readBody(event)
    const { name, folder_type, dept_code, project_code, parent_id } = body

    const normalizedName = String(name || '').trim()
    if (!normalizedName) {
      throw createError({
        statusCode: 400,
        message: '文件夹名称不能为空'
      })
    }

    if (!folder_type) {
      throw createError({
        statusCode: 400,
        message: '文件夹类型不能为空'
      })
    }

    if (!['private', 'department'].includes(String(folder_type))) {
      throw createError({
        statusCode: 503,
        message: '该文件夹类型尚未建立来源范围写入合同'
      })
    }

    let trustedDeptCode = ''
    if (folder_type === 'department') {
      if (!dept_code) {
        throw createError({
          statusCode: 400,
          message: '创建部门文件夹时必须指定 dept_code'
        })
      }

      trustedDeptCode = String(dept_code).trim()
      await requireDepartmentManagerAccess(event, operatorUid, trustedDeptCode, '仅部门经理可创建目录')
    }

    const folder = await callCodocsTenantRuntime<{ id: number }>(event, '/v1/codocs/folders', {
      method: 'POST',
      scope: 'codocs.write',
      query: folderMutationRuntimeQuery(String(folder_type), trustedDeptCode),
      body: {
        name: normalizedName,
        folder_type,
        owner_uid: operatorUid,
        dept_code: trustedDeptCode || null,
        project_code: project_code || null,
        parent_id: parent_id || null,
        sort_order: 0,
        operator_uid: operatorUid
      }
    })

    return {
      success: true,
      data: {
        id: folder.id,
        name: normalizedName,
        folder_type,
        owner_uid: operatorUid,
        parent_id
      }
    }
  } catch (error: unknown) {
    console.error('Failed to create folder:', error)
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '创建文件夹失败'
    throw createError({
      statusCode,
      message
    })
  }
})
