import { getCodocsDocumentSummary } from '~~/server/utils/codocsApi'
import { hasDepartmentAccess } from '~~/server/utils/userDepartments'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const uuid = String(getRouterParam(event, 'uuid') || '').trim()
  if (!uuid) {
    throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  }

  const res = await getCodocsDocumentSummary(uuid, event)

  const hasDeptAccess = res.data.deptCode
    ? await hasDepartmentAccess(uid, res.data.deptCode)
    : false
  if (res.data.ownerUid !== uid && !hasDeptAccess) {
    throw createError({ statusCode: 403, message: '无权访问该文档摘要' })
  }

  return {
    code: 0,
    data: res.data
  }
})
