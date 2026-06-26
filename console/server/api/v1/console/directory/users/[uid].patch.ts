import { requirePermission } from '~~/server/utils/checkPermission'
import { updateDirectoryUser, type DirectoryUserInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryUserForAdmin, ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'edit', '需要目录用户编辑权限')

  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })

  const actorUid = await requireConsoleRequestUid(event)
  const body = await readBody<DirectoryUserInput>(event)
  await updateDirectoryUser(uid, body, actorUid)

  return ok(await getDirectoryUserForAdmin(uid))
})
