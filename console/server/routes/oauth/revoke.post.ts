import type { H3Event } from 'h3'
import { createError, defineEventHandler, getHeader, readBody, readRawBody } from 'h3'
import {
  hashOpaqueValue,
  revokeAccessTokenSession,
  revokeRefreshToken,
  writeTokenEvent
} from '~~/server/utils/oidc'

type RevokeBody = Record<string, unknown>

function stringValue(value: unknown) {
  return String(value || '').trim()
}

async function readRevokeBody(event: H3Event): Promise<RevokeBody> {
  const contentType = String(getHeader(event, 'content-type') || '').toLowerCase()
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const raw = await readRawBody(event, 'utf8')
    return Object.fromEntries(new URLSearchParams(raw || ''))
  }
  return await readBody<RevokeBody>(event).catch(() => ({}))
}

export default defineEventHandler(async (event) => {
  const body = await readRevokeBody(event)
  const token = stringValue(body.token)
  const hint = stringValue(body.token_type_hint)
  const clientId = stringValue(body.client_id)

  if (!token) {
    throw createError({ statusCode: 400, message: 'invalid_request: token is required' })
  }

  let revoked = false
  if (hint === 'access_token') {
    revoked = await revokeAccessTokenSession(event, token).catch(() => false)
  } else {
    revoked = await revokeRefreshToken(token)
    if (!revoked && !hint) {
      revoked = await revokeAccessTokenSession(event, token).catch(() => false)
    }
  }

  await writeTokenEvent(event, {
    eventType: 'revoke',
    clientId: clientId || null,
    tokenHash: hashOpaqueValue(token),
    result: 'success'
  }).catch(() => undefined)

  return {
    revoked
  }
})
