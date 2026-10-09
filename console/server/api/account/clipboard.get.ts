import { getClipboard } from '~~/server/utils/runtimeCompat'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  const requestUid = await requireConsoleRequestUid(event)
  const { uid } = getQuery(event) as { uid?: string }
  if (uid && uid !== requestUid) throw createError({ statusCode: 403, message: '仅可读取当前用户的剪贴板' })
  return { code: 0, message: 'ok', data: await getClipboard(event) }
})
