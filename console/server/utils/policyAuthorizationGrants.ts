import { evaluate, type AuthorizationGrant, type Decision, type ResourceActionPolicy } from '@hzy/authz-core'

/**
 * 扁平权限快照的授权单元构建与判定。
 *
 * 快照授权单元只承载“经由哪个来源、哪个角色持有哪个权限”，刻意不携带范围谓词：
 * 扁平快照的契约是“权限并集、无对象上下文”，范围判定必须走 scoped authorization
 * （policyScopedAuthorization / Foundation scopeEvaluator）。判定统一走
 * @hzy/authz-core 的 evaluate()，与 scoped / explain 共用同一决策引擎。
 *
 * 本文件保持零 Nuxt / 零 h3 依赖，可被 node --test 直接加载做行为回归。
 */

export type FlatPermissionOrigin = 'role_permission' | 'system_role_permission' | 'baseline'

export interface CollectedFlatPermission {
  origin: FlatPermissionOrigin
  roleCode?: string
  appCode: string
  resourceCode: string
  action: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function grantSubjectType(origin: FlatPermissionOrigin): AuthorizationGrant['subjectType'] {
  return origin === 'baseline' ? 'baseline' : 'user'
}

export function buildFlatSnapshotGrants(
  collected: CollectedFlatPermission[],
  targetAppCode: string
): AuthorizationGrant[] {
  const normalizedTargetAppCode = stringValue(targetAppCode)
  const grantsById = new Map<string, AuthorizationGrant>()

  for (const permission of collected) {
    const resourceCode = stringValue(permission.resourceCode)
    const action = stringValue(permission.action)
    if (!resourceCode || !action) continue

    // bundle 记录的空 appCode 语义是“属于当前目标应用”，与 normalizeAuthorizationResources
    // 的 appMatches 行为保持一致。
    const appCode = stringValue(permission.appCode) || normalizedTargetAppCode
    const roleCode = stringValue(permission.roleCode)
    const grantId = [permission.origin, roleCode || '-', appCode, resourceCode, action].join(':')
    if (grantsById.has(grantId)) continue

    grantsById.set(grantId, {
      grantId,
      subjectType: grantSubjectType(permission.origin),
      roleCode: roleCode || undefined,
      sourceType: permission.origin,
      permission: { appCode, resourceCode, action },
      scopes: []
    })
  }

  return [...grantsById.values()]
}

export function evaluateFlatSnapshotPermission(
  grants: AuthorizationGrant[],
  required: { appCode: string, resourceCode: string, action: string },
  policy?: ResourceActionPolicy
): Decision {
  return evaluate({
    grants,
    required,
    policyOf: policy ? () => policy : undefined
  })
}
