import type { H3Event } from 'h3'
import { requireFoundationSessionUid } from '../utils/authIdentity'
import { fetchConsoleSessionApi } from '../utils/consoleSessionBridge'

type HeartbeatBody = {
  page?: unknown
  status?: unknown
}

function runtimeAppCode(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as {
    public?: { appCode?: unknown, appName?: unknown }
  }
  const appCode = String(config.public?.appCode || config.public?.appName || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(appCode) || appCode === 'console') {
    throw createError({ statusCode: 500, message: 'Application code is not configured for presence reporting' })
  }
  return appCode
}

export default defineEventHandler(async (event) => {
  await requireFoundationSessionUid(event)

  const appCode = runtimeAppCode(event)
  const body = await readBody<HeartbeatBody>(event).catch((): HeartbeatBody => ({}))
  const status = body.status === 'idle' ? 'idle' : 'active'
  const page = String(body.page || '').trim().slice(0, 512) || null

  await fetchConsoleSessionApi(event, '/api/v1/heartbeat', {
    method: 'POST',
    body: {
      sourceApp: appCode,
      page,
      status
    }
  })

  return { success: true }
})
