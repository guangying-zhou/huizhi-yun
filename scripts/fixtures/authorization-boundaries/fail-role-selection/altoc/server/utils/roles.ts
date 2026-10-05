import { resolveAuthorizationMode, selectEffectiveRoleCodes } from '@hzy/authz-core'

export function selectRoles(roleCodes: string[], requestedRoleCode: string) {
  return selectEffectiveRoleCodes({
    availableRoleCodes: roleCodes,
    requestedRoleCode,
    mode: resolveAuthorizationMode({ requestedMode: 'merged' })
  })
}
