import { requirePermission } from '~~/server/utils/checkPermission'
import { listDirectoryUsers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')
  return ok(await listDirectoryUsers(getQuery(event)))
})
