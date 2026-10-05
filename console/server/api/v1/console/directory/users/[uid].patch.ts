import { updateConsoleDirectoryUser } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import type { DirectoryUserInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryUserForAdmin, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'edit', '需要目录用户编辑权限')
  requireIdempotencyKey(event)

  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })

  const body = await readBody<DirectoryUserInput>(event)
  await updateConsoleDirectoryUser(event, uid, body as Record<string, unknown>)

  return ok(await getDirectoryUserForAdmin(uid))
})
