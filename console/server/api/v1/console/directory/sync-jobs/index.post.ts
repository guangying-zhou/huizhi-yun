import { startDirectorySyncJob, type DirectorySyncProvider, type DirectorySyncScope, type DirectorySyncType } from '~~/server/utils/directorySyncJobs'
import { ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'edit', '需要目录同步编辑权限')

  const body = await readBody<{
    providerCode?: DirectorySyncProvider
    syncType?: DirectorySyncType
    objectScope?: DirectorySyncScope
  }>(event)

  const requestedBy = await requireConsoleRequestUid(event)
  const job = await startDirectorySyncJob({
    providerCode: body.providerCode,
    syncType: body.syncType,
    objectScope: body.objectScope,
    requestedBy,
    event
  })

  return ok(job)
})
