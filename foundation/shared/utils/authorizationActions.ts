import {
  actionSatisfies,
  type ResourceActionPolicy
} from '@hzy/authz-core'

export type { ResourceActionPolicy } from '@hzy/authz-core'

export type AuthorizationResources = Record<string, readonly string[] | undefined>

/**
 * 资源快照动作判定的统一薄适配器。
 *
 * 动作蕴含语义只由 @hzy/authz-core 维护；业务模块不得再手写
 * view <- edit <- admin 等层级。manifest 提供的策略可通过 policy 传入。
 */
export function authorizationActionsAllow(
  grantedActions: readonly string[] | null | undefined,
  requiredAction: string,
  policy?: ResourceActionPolicy
) {
  const required = String(requiredAction || '').trim()
  if (!required) return false

  return (grantedActions || []).some((grantedAction) => {
    const granted = String(grantedAction || '').trim()
    return Boolean(granted) && actionSatisfies(granted, required, policy)
  })
}

export function authorizationResourcesAllow(
  resources: AuthorizationResources | null | undefined,
  resourceCode: string,
  requiredAction: string,
  policy?: ResourceActionPolicy
) {
  const resource = String(resourceCode || '').trim()
  if (!resource) return false
  return authorizationActionsAllow(resources?.[resource], requiredAction, policy)
}
