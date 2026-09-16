import { requirePermission } from '~~/server/utils/checkPermission'
import { listDirectoryDepartments, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'view')
  return ok(await listDirectoryDepartments(getQuery(event)))
})
