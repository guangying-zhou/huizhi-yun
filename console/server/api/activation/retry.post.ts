import { refreshPlatformBundle } from '~~/server/utils/platformRuntime'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')

  const result = await refreshPlatformBundle('manual-retry', event)

  return {
    code: result.ok ? 0 : 1,
    message: result.error || 'ok',
    data: result.status
  }
})
