import { requirePermission } from '~~/server/utils/checkPermission'
import { createDirectoryUser, type DirectoryUserInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryUserForAdmin, ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'edit', '需要目录用户编辑权限')

  const actorUid = await requireConsoleRequestUid(event)
  const body = await readBody<DirectoryUserInput>(event)
  await createDirectoryUser(body, actorUid)

  const uid = String(body.uid || '').trim()
  return ok(await getDirectoryUserForAdmin(uid))
})
