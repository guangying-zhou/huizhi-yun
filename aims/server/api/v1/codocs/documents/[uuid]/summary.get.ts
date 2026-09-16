import { hasDepartmentAccess } from '~~/server/utils/userDepartments'

function text(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const uuid = text(getRouterParam(event, 'uuid'))
  if (!uuid) {
    throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  }

  const query = getQuery(event)
  const requestedDeptCode = text(query.deptCode || query.dept_code)
  if (!requestedDeptCode) {
    throw createError({ statusCode: 400, message: 'deptCode 不能为空' })
  }

  const hasRequestedDeptAccess = await hasDepartmentAccess(event, uid, requestedDeptCode)
  if (!hasRequestedDeptAccess) {
    throw createError({ statusCode: 403, message: '无权访问该部门文档摘要' })
  }

  // Aims only records `project_proposal` after the project exists.  A browser
  // supplied UUID plus a matching department is therefore not an immutable
  // proposal classification, and the old generic Codocs summary path cannot
  // prove the original Codocs ACL for this actor.  Do not restore that broad
  // read while the dedicated, source-bound proposal contract is absent.
  throw createError({
    statusCode: 503,
    data: { code: 'department_project_proposal_classification_required' },
    message: '部门立项书权威分类与双重授权合同尚未启用'
  })
})
