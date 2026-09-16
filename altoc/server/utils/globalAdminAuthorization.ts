import { appCode, resources as manifestResources } from '~~/app/config/permissions'
import type { LoadAuthorizationFromPlatformBundleOptions } from '@hzy/foundation/server/utils/platformBundleAuthorization'

export const ALTOC_GLOBAL_ADMIN_ROLE_CODES = [
  'system_admin',
  'super_admin',
  'platform:admin',
  'platform:super_admin'
]

export const altocGlobalAdminExpansion: NonNullable<LoadAuthorizationFromPlatformBundleOptions['globalAdminExpansion']> = {
  resources: manifestResources,
  roleCode: `${appCode}:admin`,
  adminRoleCodes: ALTOC_GLOBAL_ADMIN_ROLE_CODES
}

export function hasAltocGlobalAdminRole(roles: Iterable<string>) {
  const adminRoleCodes = new Set(ALTOC_GLOBAL_ADMIN_ROLE_CODES)
  for (const role of roles) {
    if (adminRoleCodes.has(String(role || '').trim())) return true
  }
  return false
}
