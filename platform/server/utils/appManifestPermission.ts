export interface ManifestPermission {
  appCode: string
  resourceCode: string
  action: string
}

function manifestPermissionError(message: string) {
  const error = new Error(message) as Error & { statusCode: number, statusMessage: string }
  error.statusCode = 400
  error.statusMessage = 'Bad Request'
  return error
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
    throw manifestPermissionError(`recommendedRoles[${roleCode}].suggestedPermissions[${index}] must use app:resource:action`)
  }

  if (permissionAppCode !== appCode) {
    throw manifestPermissionError(`recommendedRoles[${roleCode}].suggestedPermissions[${index}] appCode mismatch: expected ${appCode}, got ${permissionAppCode}`)
  }

  return { appCode: permissionAppCode, resourceCode, action }
}
