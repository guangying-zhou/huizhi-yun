import { listOnlineHeartbeats } from '~~/server/utils/runtimeCompat'

export default defineEventHandler(async (event) => {
  const { sourceApp } = getQuery(event) as { sourceApp?: string }
  return { success: true, data: await listOnlineHeartbeats(sourceApp) }
})
