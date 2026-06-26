import { createError } from 'h3'

export interface ManifestPermission {
  appCode: string
  resourceCode: string
  action: string
}

export function parseManifestPermissionString(
  value: string,
  appCode: string,
  roleCode: string,
  index: number
): ManifestPermission {
  const normalized = value.trim()
  const appSeparator = normalized.indexOf(':')
  const resourceSeparator = normalized.indexOf(':', appSeparator + 1)
  const permissionAppCode = normalized.slice(0, appSeparator).trim()
  const resourceCode = normalized.slice(appSeparator + 1, resourceSeparator).trim()
  const action = normalized.slice(resourceSeparator + 1).trim()

  if (
    appSeparator <= 0
    || resourceSeparator <= appSeparator + 1
    || !permissionAppCode
    || !resourceCode
    || !action
    || action.split(':').some(part => !part.trim())
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `recommendedRoles[${roleCode}].suggestedPermissions[${index}] must use app:resource:action`
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
