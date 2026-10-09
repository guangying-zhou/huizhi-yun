import { createError, defineEventHandler, getHeader, readBody, setHeader } from 'h3'
import { verifyAccessToken, writeTokenEvent } from '~~/server/utils/oidc'
import {
  explainPlatformInstanceConflicts,
  type PlatformInstancePrincipalInput
} from '~~/server/utils/platformInstanceConflictExplanation'

interface InstanceConflictExplainBody {
  appCode?: unknown
  resourceCode?: unknown
  action?: unknown
  activeRoleCode?: unknown
  authorizationMode?: unknown
  includeBaseline?: unknown
  object?: unknown
  principals?: unknown
}

function text(value: unknown) {
  return String(value || '').trim()
}

function bearerToken(value: unknown) {
  const header = text(value)
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function uidFromPayload(payload: Awaited<ReturnType<typeof verifyAccessToken>>) {
  return text((payload.hzy as { uid?: unknown } | undefined)?.uid)
    || text(payload.sub).replace(/^user:/, '')
}

function audienceFromPayload(payload: Awaited<ReturnType<typeof verifyAccessToken>>) {
  if (typeof payload.aud === 'string') return payload.aud
  if (Array.isArray(payload.aud)) return text(payload.aud[0])
  return ''
}

function booleanValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(text(value).toLowerCase())
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function principalValue(value: unknown): PlatformInstancePrincipalInput[] {
  return Array.isArray(value)
    ? value
        .filter(item => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const principal = item as Record<string, unknown>
          return {
            kind: text(principal.kind),
            uid: text(principal.uid) || null
          }
        })
        .filter(item => item.kind && item.uid)
    : []
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

  const body = await readBody<InstanceConflictExplainBody>(event)
  const audience = audienceFromPayload(payload)
  const targetAppCode = text(body.appCode) || audience
  const resourceCode = text(body.resourceCode)
  const action = text(body.action)
  if (!targetAppCode || !resourceCode || !action) {
    throw createError({ statusCode: 400, message: 'appCode, resourceCode and action are required' })
  }

  const result = await explainPlatformInstanceConflicts(event, {
    uid,
    appCode: targetAppCode,
    resourceCode,
    action,
    activeRoleCode: text(body.activeRoleCode),
    authorizationMode: text(body.authorizationMode),
    includeBaseline: booleanValue(body.includeBaseline, true),
    object: objectValue(body.object),
    principals: principalValue(body.principals)
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
    data: result
  }
})
