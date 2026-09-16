import { getConsoleDirectorySyncJobs } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'view')
  const runtime = await getConsoleDirectorySyncJobs(event, {
    limit: Number(getQuery(event).limit || 20)
  })
  return ok(runtime.data)
})
