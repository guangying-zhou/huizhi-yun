import { createError, defineEventHandler, getHeader } from 'h3'
import { getUserinfoForPayload, verifyAccessToken, writeTokenEvent } from '~~/server/utils/oidc'
import { authDiagnosticRequestId } from '@hzy/foundation/server/utils/authDependencyDiagnostic'

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
  const auditStartedAt = Date.now()
  await writeTokenEvent(event, {
    eventType: 'introspect',
    clientId: typeof payload.aud === 'string' ? payload.aud : null,
    uid: typeof (payload.hzy as { uid?: unknown } | undefined)?.uid === 'string' ? String((payload.hzy as { uid?: unknown }).uid) : null,
    sessionHash: typeof payload.sid === 'string' ? payload.sid : null,
    result: 'success'
  }).catch(() => {
    console.warn(JSON.stringify({ event: 'console-auth-audit-failure', requestId: authDiagnosticRequestId(event),
      stage: 'token-event', durationMs: Date.now() - auditStartedAt }))
  })
  const auditDurationMs = Date.now() - auditStartedAt
  if (auditDurationMs > 1000) {
    console.info(JSON.stringify({ event: 'console-auth-audit-slow', requestId: authDiagnosticRequestId(event),
      stage: 'token-event', durationMs: auditDurationMs }))
  }

  return getUserinfoForPayload(payload)
})
