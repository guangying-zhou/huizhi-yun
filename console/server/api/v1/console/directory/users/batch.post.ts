import { getConsoleDirectoryUsersBatch } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')

  const body = await readBody<{ uids?: string[] }>(event)
  if (!Array.isArray(body.uids)) throw createError({ statusCode: 400, message: 'uids array is required' })
  return await getConsoleDirectoryUsersBatch(event, body.uids)
})
