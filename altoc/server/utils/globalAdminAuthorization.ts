import { appCode, resources as manifestResources } from '~~/app/config/permissions'
import type { LoadAuthorizationFromPlatformBundleOptions } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { ALTOC_GLOBAL_ADMIN_ROLE_CODES, hasAltocGlobalAdminRole as hasGlobalAdminRole } from './altocDataAccessScope'

export { ALTOC_GLOBAL_ADMIN_ROLE_CODES }

export const altocGlobalAdminExpansion: NonNullable<LoadAuthorizationFromPlatformBundleOptions['globalAdminExpansion']> = {
  resources: manifestResources,
  roleCode: `${appCode}:admin`,
  adminRoleCodes: ALTOC_GLOBAL_ADMIN_ROLE_CODES
}

export function hasAltocGlobalAdminRole(roles: Iterable<string>) {
  return hasGlobalAdminRole(roles)
}
