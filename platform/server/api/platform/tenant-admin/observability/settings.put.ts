import { ok, requireString } from '~~/server/utils/api'
import { requestObservability } from '~~/server/utils/observability'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body?.tenantCode, 'tenantCode').trim()
  const appCode = requireString(body?.appCode, 'appCode').trim()

  const data = await requestObservability('/api/observability/settings', {
    method: 'PUT',
    body: {
      tenantCode,
      appCode,
      enabled: body.enabled,
      sampleRate: body.sampleRate,
      errorSampleRate: body.errorSampleRate,
      slowThresholdMs: body.slowThresholdMs
    }
  })

  return ok(data)
})
