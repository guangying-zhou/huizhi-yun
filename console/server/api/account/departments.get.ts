/**
 * Account 兼容入口：获取部门树。
 */
import { listDirectoryDepartments, ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'view')
  return ok(await listDirectoryDepartments(getQuery(event)))
})
