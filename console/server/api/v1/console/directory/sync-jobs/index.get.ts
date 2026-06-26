import { listDirectorySyncJobs } from '~~/server/utils/directorySyncJobs'
import { ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'view')
  return ok(await listDirectorySyncJobs(Number(getQuery(event).limit || 20)))
})
