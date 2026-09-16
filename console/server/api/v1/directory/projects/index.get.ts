import { requirePermission } from '~~/server/utils/checkPermission'
import { listDirectoryProjects, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'view')
  return ok(await listDirectoryProjects(getQuery(event)))
})
