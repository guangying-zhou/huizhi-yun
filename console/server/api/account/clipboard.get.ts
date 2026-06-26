import { getClipboard } from '~~/server/utils/runtimeCompat'

export default defineEventHandler(async (event) => {
  const { uid } = getQuery(event) as { uid?: string }
  return { code: 0, message: 'ok', data: await getClipboard(uid || '') }
})
