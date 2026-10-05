import { fetchConsoleRuntimeResponse } from '../../utils/directoryCompat'
import { requireRequestUid } from '../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event)
  const rawBody = await readBody(event)
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown>
    : {}

  return fetchConsoleRuntimeResponse('/api/v1/clipboard', {
    method: 'POST',
    body: {
      ...body,
      uid,
      sourceApp: 'codocs'
    },
    timeout: 10000
  })
})
