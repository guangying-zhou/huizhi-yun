import { createError, defineEventHandler, getHeader, readBody, setHeader } from 'h3'
import { verifyAccessToken, writeTokenEvent } from '~~/server/utils/oidc'
import {
  isPolicyAuthorizationError
} from '~~/server/utils/policyAuthorization'
import { loadPolicyScopedAuthorization } from '~~/server/utils/policyScopedAuthorization'
import type { FoundationObjectContext } from '@hzy/foundation/server/utils/scopeEvaluator'

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

function audienceFromPayload(payload: Awaited<ReturnType<typeof verifyAccessToken>>) {
  if (typeof payload.aud === 'string') return payload.aud
  if (Array.isArray(payload.aud)) return stringValue(payload.aud[0])
  return ''
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')

  const token = bearerToken(getHeader(event, 'authorization'))
  if (!token) {
    throw createError({ statusCode: 401, message: 'invalid_token: bearer token is required' })
  }

  const payload = await verifyAccessToken(event, token)
  const uid = uidFromPayload(payload)
  if (!uid) {
    throw createError({ statusCode: 401, message: 'invalid_token: uid missing' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const audience = audienceFromPayload(payload)
  const targetAppCode = stringValue(body.appCode) || audience
  if (!targetAppCode) {
    throw createError({ statusCode: 400, message: 'appCode is required' })
  }

  try {
    const snapshot = await loadPolicyScopedAuthorization(uid, targetAppCode, event, {
      activeRoleCode: stringValue(body.activeRoleCode),
      authorizationMode: stringValue(body.authorizationMode),
      resourceCode: stringValue(body.resourceCode),
      action: stringValue(body.action),
      object: (body.object && typeof body.object === 'object' && !Array.isArray(body.object))
        ? body.object as FoundationObjectContext
        : undefined
    })

    await writeTokenEvent(event, {
      eventType: 'introspect',
      clientId: audience || null,
      uid,
      sessionHash: typeof payload.sid === 'string' ? payload.sid : null,
      result: 'success'
    }).catch(() => undefined)

    return {
      code: 0,
      data: snapshot
    }
  } catch (error) {
    if (isPolicyAuthorizationError(error)) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'Policy Authorization Unavailable',
        message: error.message,
        data: {
          reason: error.reason
        }
      })
    }

    const message = error instanceof Error ? error.message : String(error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Policy Scoped Authorization Failed',
      message
    })
  }
})
