import { setClipboard, type ClipboardInput } from '~~/server/utils/runtimeCompat'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  const requestUid = await requireConsoleRequestUid(event)
  const body = await readBody<ClipboardInput & { uid?: string }>(event)
  if (body.uid && body.uid !== requestUid) {
    throw createError({ statusCode: 403, message: '仅可写入当前用户的剪贴板' })
  }
  await setClipboard(event, body)
  return { code: 0, message: 'ok' }
})
