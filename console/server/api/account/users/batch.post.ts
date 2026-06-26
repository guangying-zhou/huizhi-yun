/**
 * Account 兼容入口：批量获取用户。
 */
import { batchDirectoryUsers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ uids?: string[] }>(event)
  if (!Array.isArray(body.uids)) throw createError({ statusCode: 400, message: 'uids array is required' })
  return ok(await batchDirectoryUsers(body.uids))
})
