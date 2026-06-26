import { requirePermission } from '~~/server/utils/checkPermission'
import { getDirectorySource } from '~~/server/utils/directorySources'
import { ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sources', 'view')

  const providerCode = getRouterParam(event, 'providerCode')
  if (!providerCode) throw createError({ statusCode: 400, message: 'providerCode is required' })

  const source = await getDirectorySource(providerCode)
  if (!source) throw createError({ statusCode: 404, message: 'Directory source not found' })

  return ok(source)
})
