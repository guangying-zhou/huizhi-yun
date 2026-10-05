/**
 * Account 兼容入口：获取用户项目归属。
 */
import { listDirectoryUserProjects, ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')
  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })
  return ok(await listDirectoryUserProjects(uid, getQuery(event)))
})
