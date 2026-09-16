/**
 * Account 兼容入口：获取项目注册表。
 */
import { listDirectoryProjects, ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'view')
  return ok(await listDirectoryProjects(getQuery(event)))
})
