import { loadActivationStatus, refreshPlatformBundle } from '~~/server/utils/platformRuntime'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')

  const status = await loadActivationStatus(event)
  if (status.activated) {
    return {
      code: 0,
      data: status
    }
  }

  const result = await refreshPlatformBundle('status-auto-refresh', event).catch(() => null)
  return {
    code: 0,
    data: result?.status || status
  }
})
