import { createError, readBody, setHeader } from 'h3'
import { appCode } from '~~/app/config/permissions'
import { resolveConsoleSession } from '~~/server/utils/authSession'
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

  const session = await resolveConsoleSession(event)
  const body = await readBody<InstanceConflictExplainBody>(event)
  const targetAppCode = text(body.appCode) || appCode
  const resourceCode = text(body.resourceCode)
  const action = text(body.action)
  if (!targetAppCode || !resourceCode || !action) {
    throw createError({ statusCode: 400, message: 'appCode, resourceCode and action are required' })
  }

  const result = await explainPlatformInstanceConflicts(event, {
    uid: session.uid,
    appCode: targetAppCode,
    resourceCode,
    action,
    activeRoleCode: text(body.activeRoleCode),
    authorizationMode: text(body.authorizationMode),
    includeBaseline: booleanValue(body.includeBaseline, true),
    object: objectValue(body.object),
    principals: principalValue(body.principals)
  })

  return {
    code: 0,
    data: result
  }
})
