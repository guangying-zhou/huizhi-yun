import { requirePermission } from '~~/server/utils/checkPermission'
import { listDirectoryUserDepartments, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')

  const query = getQuery(event)
  return ok(await listDirectoryUserDepartments(query.uid ? String(query.uid) : undefined))
})
