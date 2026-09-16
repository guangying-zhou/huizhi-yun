import { requirePermission } from '~~/server/utils/checkPermission'
import { getConsoleDirectorySource } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sources', 'view')

  const providerCode = getRouterParam(event, 'providerCode')
  if (!providerCode) throw createError({ statusCode: 400, message: 'providerCode is required' })
  return await getConsoleDirectorySource(event, providerCode)
})
