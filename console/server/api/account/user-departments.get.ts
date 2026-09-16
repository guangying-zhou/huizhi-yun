/**
 * Account 兼容入口：获取用户关联部门。
 */
import { listDirectoryUserDepartments, ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')
  const query = getQuery(event)
  const uid = query.uid ? String(query.uid) : undefined
  return ok(await listDirectoryUserDepartments(uid))
})
