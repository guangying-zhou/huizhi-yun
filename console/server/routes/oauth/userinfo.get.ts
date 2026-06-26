import { createError, defineEventHandler, getHeader } from 'h3'
import { getUserinfoForPayload, verifyAccessToken, writeTokenEvent } from '~~/server/utils/oidc'

function bearerToken(value: unknown) {
  const header = String(value || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

export default defineEventHandler(async (event) => {
  const token = bearerToken(getHeader(event, 'authorization'))
  if (!token) {
    throw createError({ statusCode: 401, message: 'invalid_token: bearer token is required' })
  }

  const payload = await verifyAccessToken(event, token)
  await writeTokenEvent(event, {
    eventType: 'introspect',
    clientId: typeof payload.aud === 'string' ? payload.aud : null,
    uid: typeof (payload.hzy as { uid?: unknown } | undefined)?.uid === 'string' ? String((payload.hzy as { uid?: unknown }).uid) : null,
    sessionHash: typeof payload.sid === 'string' ? payload.sid : null,
    result: 'success'
  }).catch(() => undefined)

  return getUserinfoForPayload(payload)
})
