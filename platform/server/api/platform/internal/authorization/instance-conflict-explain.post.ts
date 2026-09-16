import { readBody } from 'h3'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import {
  explainInstanceConflicts,
  type InstancePrincipalInput
} from '~~/server/utils/instanceConflictExplanation'

interface InstanceConflictExplainBody {
  tenantCode?: unknown
  uid?: unknown
  appCode?: unknown
  resourceCode?: unknown
  action?: unknown
  activeRoleCode?: unknown
  authorizationMode?: unknown
  includeBaseline?: unknown
  object?: unknown
  principals?: unknown
}

function booleanValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(normalized)
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function principalValue(value: unknown): InstancePrincipalInput[] {
  return Array.isArray(value)
    ? value
        .filter(item => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const principal = item as Record<string, unknown>
          return {
            kind: normalizeNullableString(principal.kind) || '',
            uid: normalizeNullableString(principal.uid)
          }
        })
        .filter(item => item.kind && item.uid)
    : []
}

export default defineEventHandler(async (event) => {
  if (event.context.platformAccessScope !== 'internal') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'internal access required'
    })
  }

  const body = await readBody<InstanceConflictExplainBody>(event).catch(() => ({} as InstanceConflictExplainBody))

  const result = await explainInstanceConflicts({
    tenantCode: requireString(body.tenantCode, 'tenantCode'),
    uid: requireString(body.uid, 'uid'),
    appCode: requireString(body.appCode, 'appCode'),
    resourceCode: requireString(body.resourceCode, 'resourceCode'),
    action: requireString(body.action, 'action'),
    activeRoleCode: normalizeNullableString(body.activeRoleCode),
    authorizationMode: normalizeNullableString(body.authorizationMode),
    includeBaseline: booleanValue(body.includeBaseline, true),
    object: objectValue(body.object),
    principals: principalValue(body.principals)
  })

  return ok(result)
})
