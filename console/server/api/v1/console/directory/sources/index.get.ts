import { requirePermission } from '~~/server/utils/checkPermission'
import { listDirectorySources } from '~~/server/utils/directorySources'
import { ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sources', 'view')
  return ok(await listDirectorySources())
})
