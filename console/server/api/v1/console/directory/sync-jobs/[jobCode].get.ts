import { getConsoleDirectorySyncJob } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'view')

  const jobCode = getRouterParam(event, 'jobCode')
  if (!jobCode) throw createError({ statusCode: 400, message: 'jobCode is required' })

  const runtime = await getConsoleDirectorySyncJob(event, jobCode)
  return ok(runtime.data)
})
