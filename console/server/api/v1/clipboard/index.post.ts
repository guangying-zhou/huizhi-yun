import { setClipboard } from '~~/server/utils/runtimeCompat'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requireConsoleRequestUid(event)
  await setClipboard(event, await readBody(event))
  return { code: 0, message: 'ok' }
})
