import { createError } from 'h3'
import { parseManifestDefaultScopes, type ManifestDefaultScope } from './appManifestDefaultScopes.ts'
import { parseManifestPermissionString, type ManifestPermission } from './appManifestPermission.ts'

export interface ManifestRecommendedRole {
  roleCode: string
  roleName: string
  description: string | null
  permissions: ManifestPermission[]
  defaultScopes?: ManifestDefaultScope[]
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseSuggestedPermission(value: unknown, appCode: string, roleCode: string, index: number): ManifestPermission {
  if (typeof value === 'string') {
    return parseManifestPermissionString(value, appCode, roleCode, index)
  }

  const record = asRecord(value)
  const permissionAppCode = normalizeString(record?.appCode) || appCode
  const resourceCode = normalizeString(record?.resourceCode)
  const action = normalizeString(record?.action)

  if (!record || !permissionAppCode || !resourceCode || !action) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `recommendedRoles[${roleCode}].suggestedPermissions[${index}] requires appCode/resourceCode/action`
    })
  }

  if (permissionAppCode !== appCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `recommendedRoles[${roleCode}].suggestedPermissions[${index}] appCode mismatch: expected ${appCode}, got ${permissionAppCode}`
    })
  }

  return { appCode: permissionAppCode, resourceCode, action }
}

export function parseRecommendedRoles(appCode: string, manifestJson: Record<string, unknown>) {
  const rawRoles = manifestJson.recommendedRoles
  if (!Array.isArray(rawRoles)) {
    return []
  }

  return rawRoles.map((rawRole, roleIndex) => {
    const record = asRecord(rawRole)
    const roleCode = normalizeString(record?.code)
    if (!record || !roleCode) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `recommendedRoles[${roleIndex}].code is required`
      })
    }

    if (!roleCode.startsWith(`${appCode}:`)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `recommendedRoles[${roleIndex}].code must start with ${appCode}:`
      })
    }

    const rawPermissions = record.suggestedPermissions
    const permissions = Array.isArray(rawPermissions)
      ? rawPermissions.map((permission, permissionIndex) =>
          parseSuggestedPermission(permission, appCode, roleCode, permissionIndex)
        )
      : []

    return {
      roleCode,
      roleName: normalizeString(record.name) || roleCode,
      description: normalizeString(record.description) || null,
      permissions,
      defaultScopes: parseManifestDefaultScopes(record, permissions, manifestJson.supportedScopes)
    } satisfies ManifestRecommendedRole
  })
}
