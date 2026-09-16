import { getConsoleDirectorySyncEvents } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'view')

  const jobCode = getRouterParam(event, 'jobCode')
  if (!jobCode) throw createError({ statusCode: 400, message: 'jobCode is required' })

  const limit = Number(getQuery(event).limit || 100)
  const runtime = await getConsoleDirectorySyncEvents(event, jobCode, { limit })
  return ok(runtime.data)
})
