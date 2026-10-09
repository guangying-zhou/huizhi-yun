/**
 * Account 兼容入口：获取用户可管理/可访问部门。
 */
import { listAccessibleDepartments, ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  const requestUid = await requireConsoleRequestUid(event)
  const query = getQuery(event)
  const uid = String(query.uid || '').trim()
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })
  if (uid !== requestUid) throw createError({ statusCode: 403, message: '仅可读取当前用户的可访问部门' })
  return ok(await listAccessibleDepartments(uid))
})
