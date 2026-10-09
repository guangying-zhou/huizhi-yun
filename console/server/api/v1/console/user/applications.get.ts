import { createError, defineEventHandler, getHeader } from 'h3'
import { getConsoleUserApplications } from '~~/server/utils/userApplications'
import { verifyAccessToken, writeTokenEvent } from '~~/server/utils/oidc'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function bearerToken(value: unknown) {
  const header = stringValue(value)
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function uidFromPayload(payload: Awaited<ReturnType<typeof verifyAccessToken>>) {
  return stringValue((payload.hzy as { uid?: unknown } | undefined)?.uid)
    || stringValue(payload.sub).replace(/^user:/, '')
}

export default defineEventHandler(async (event) => {
  const token = bearerToken(getHeader(event, 'authorization'))
  if (!token) {
    throw createError({ statusCode: 401, message: 'invalid_token: bearer token is required' })
  }

  const payload = await verifyAccessToken(event, token)
  const uid = uidFromPayload(payload)
  if (!uid) {
    throw createError({ statusCode: 401, message: 'invalid_token: uid missing' })
  }

  await writeTokenEvent(event, {
    eventType: 'introspect',
    clientId: typeof payload.aud === 'string' ? payload.aud : null,
    uid,
    sessionHash: typeof payload.sid === 'string' ? payload.sid : null,
    result: 'success'
  }).catch(() => undefined)

  return {
    code: 0,
    data: await getConsoleUserApplications(event, uid)
  }
})
