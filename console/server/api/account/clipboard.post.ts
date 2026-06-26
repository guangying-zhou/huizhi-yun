import { setClipboard } from '~~/server/utils/runtimeCompat'

export default defineEventHandler(async (event) => {
  await setClipboard(await readBody(event))
  return { code: 0, message: 'ok' }
})
