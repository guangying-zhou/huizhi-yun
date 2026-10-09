import { consoleSyncReadQuery } from '@hzy/foundation/shared/utils/consoleSyncReadQuery'
import { getConsoleDirectorySyncJobs } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'view')
  let query: Record<string, string>
  try {
    query = consoleSyncReadQuery(getQuery(event))
  } catch {
    throw createError({ statusCode: 400, message: '同步分页参数无效' })
  }
  const runtime = await getConsoleDirectorySyncJobs(event, query)
  return ok(runtime.data)
})
