import { requirePermission } from '~~/server/utils/checkPermission'
import { listDirectoryUserProjects, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')

  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })
  return ok(await listDirectoryUserProjects(uid, getQuery(event)))
})
