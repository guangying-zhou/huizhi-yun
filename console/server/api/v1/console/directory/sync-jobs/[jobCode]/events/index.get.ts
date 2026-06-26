import { getDirectorySyncJob, listDirectorySyncEvents } from '~~/server/utils/directorySyncJobs'
import { ok } from '~~/server/utils/directoryRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'view')

  const jobCode = getRouterParam(event, 'jobCode')
  if (!jobCode) throw createError({ statusCode: 400, message: 'jobCode is required' })

  const job = await getDirectorySyncJob(jobCode)
  if (!job) throw createError({ statusCode: 404, message: 'Directory sync job not found' })

  const limit = Number(getQuery(event).limit || 100)
  return ok(await listDirectorySyncEvents(jobCode, limit))
})
