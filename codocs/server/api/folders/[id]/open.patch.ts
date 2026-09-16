/**
 * 设置部门文档目录开放状态
 * PATCH /api/folders/:id/open
 */
import { requireDepartmentManagerAccess } from '~~/server/utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { CODOCS_TRUSTED_DEPARTMENT_MANAGE_QUERY_KEY } from '~~/server/utils/documentReadScope'

function boolValue(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件夹ID不能为空' })
  }

  const actorUid = requireRequestUid(event)
  const body = await readBody<Record<string, unknown>>(event)
  const deptCode = String(body?.dept_code ?? body?.deptCode ?? '').trim()
  if (!deptCode) {
    throw createError({ statusCode: 400, message: '部门编码不能为空' })
  }
  const hasOpenValue = body && (
    Object.prototype.hasOwnProperty.call(body, 'is_open')
    || Object.prototype.hasOwnProperty.call(body, 'isOpen')
  )
  if (!hasOpenValue) {
    throw createError({ statusCode: 400, message: '开放状态不能为空' })
  }

  await requireDepartmentManagerAccess(event, actorUid, deptCode, '仅部门负责人可设置开放目录')

  const isOpen = boolValue(body?.is_open ?? body?.isOpen)
  const result = await callCodocsTenantRuntime<{ id: number, is_open: number, updated: boolean }>(
    event,
    `/v1/codocs/folders/${encodeURIComponent(id)}/open`,
    {
      method: 'PATCH',
      scope: 'codocs.write',
      query: { [CODOCS_TRUSTED_DEPARTMENT_MANAGE_QUERY_KEY]: deptCode },
      body: { is_open: isOpen }
    }
  )

  return {
    success: true,
    data: {
      id: result.id || Number(id),
      is_open: result.is_open,
      updated: result.updated !== false
    }
  }
})
