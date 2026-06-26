/**
 * Account 兼容入口：获取单个用户详情。
 */
import { getDirectoryUser, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })

  const user = await getDirectoryUser(uid)
  if (!user) throw createError({ statusCode: 404, message: 'User not found' })

  return ok(user)
})
