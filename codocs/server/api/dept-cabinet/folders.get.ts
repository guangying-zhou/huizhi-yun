/**
 * 获取部门文件柜文件夹列表
 * GET /api/dept-cabinet/folders?dept_code=xxx&parent_id=null
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireDepartmentReadAccess } from '~~/server/utils/departmentAccess'
import { CODOCS_TRUSTED_CABINET_DEPARTMENT_QUERY_KEY } from '~~/server/utils/cabinetRuntime'

interface RuntimePage {
  items?: unknown[]
}

export default defineEventHandler(async (event) => {
  const actorUid = requireRequestUid(event)
  await requirePermission(event, 'documents', 'view', '缺少文档查看权限')

  const query = { ...getQuery(event) } as Record<string, unknown>
  const deptCode = query.dept_code as string

  if (!deptCode) {
    throw createError({ statusCode: 400, message: 'dept_code 不能为空' })
  }

  await requireDepartmentReadAccess(event, actorUid, deptCode)
  for (const key of [
    'owner_uid', 'ownerUid', 'dept_code', 'deptCode',
    'current_user', 'currentUser', 'operator_uid', 'operatorUid', 'actor_uid', 'actorUid',
    CODOCS_TRUSTED_CABINET_DEPARTMENT_QUERY_KEY
  ]) {
    Reflect.deleteProperty(query, key)
  }

  const data = await callCodocsTenantRuntime<RuntimePage>(event, '/v1/codocs/dept-cabinet/folders', {
    query: { ...query, [CODOCS_TRUSTED_CABINET_DEPARTMENT_QUERY_KEY]: deptCode },
    scope: 'codocs.read'
  })

  return { success: true, data: { items: data.items || [] } }
})
