import { requirePermission } from '~~/server/utils/checkPermission'
import { batchDirectoryUsers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')

  const body = await readBody<{ uids?: string[] }>(event)
  if (!Array.isArray(body.uids)) throw createError({ statusCode: 400, message: 'uids array is required' })
  return ok(await batchDirectoryUsers(body.uids))
})
