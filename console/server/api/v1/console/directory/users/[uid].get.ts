import { requirePermission } from '~~/server/utils/checkPermission'
import { getDirectoryUserForAdmin, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'view')

  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })

  const user = await getDirectoryUserForAdmin(uid)
  if (!user) throw createError({ statusCode: 404, message: 'User not found' })

  return ok(user)
})
