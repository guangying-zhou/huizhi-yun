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

  // Malformed JWTs must remain authentication failures when this handler owns
  // the boundary; do not turn syntax/JOSE errors into an unhandled HTTP 500.
  if (token.split('.').length !== 3 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw createError({ statusCode: 401, message: 'invalid_token' })
  }
  const payload = await verifyAccessToken(event, token).catch((error: unknown) => {
    const code = String((error as { code?: unknown })?.code || '')
    if (error instanceof SyntaxError || /^ERR_(?:JWT|JWS|JOSE)_/.test(code)) {
      throw createError({ statusCode: 401, message: 'invalid_token' })
    }
    throw error
  })
  await writeTokenEvent(event, {
    eventType: 'introspect',
    clientId: typeof payload.aud === 'string' ? payload.aud : null,
    uid: typeof (payload.hzy as { uid?: unknown } | undefined)?.uid === 'string' ? String((payload.hzy as { uid?: unknown }).uid) : null,
    sessionHash: typeof payload.sid === 'string' ? payload.sid : null,
    result: 'success'
  }).catch(() => undefined)

  return getUserinfoForPayload(payload)
})
