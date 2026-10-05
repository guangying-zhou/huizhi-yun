import { actionSatisfies } from '@hzy/authz-core'
import { isEnterpriseRoleRecord } from '@hzy/foundation/server/utils/authorizationRoles'
import { resolveConsoleSession } from '~~/server/utils/authSession'
import { loadPolicyAuthorizationSnapshot } from '~~/server/utils/policyAuthorization'

interface EnterpriseRoleOption {
  roleCode: string
  roleName: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
    : []
}

function hasCapability(resources: Record<string, string[]>, resourceCode: string, action: string) {
  return (resources[resourceCode] || []).some(held => actionSatisfies(held, action))
}

/**
 * 权限模拟弹窗的企业角色下拉数据源。角色目录取自已缓存 policy bundle 的
 * `payload.roles`（租户企业角色全集），而不是操作者自身持有的
 * `availableRoles`——系统管理员发起模拟正是为了检查自己未持有的角色，
 * 用"已持有角色"当下拉数据源会让模拟功能名不副实。
 */
export default defineEventHandler(async (event) => {
  const session = await resolveConsoleSession(event)
  const snapshot = await loadPolicyAuthorizationSnapshot(session.uid, 'platform', event, {
    ignoreSimulationSession: true
  })

  const canSimulate = hasCapability(snapshot.resources, 'authorization', 'simulate-role')
    || hasCapability(snapshot.resources, 'authorization', 'simulate-user')
  if (!canSimulate) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'platform:authorization:simulate-role or simulate-user is required'
    })
  }

  const seen = new Set<string>()
  const items: EnterpriseRoleOption[] = []

  for (const role of records(snapshot.payload?.roles)) {
    const roleCode = stringValue(role.roleCode)
    if (!roleCode || seen.has(roleCode)) continue
    if (!isEnterpriseRoleRecord(role)) continue

    seen.add(roleCode)
    items.push({
      roleCode,
      roleName: stringValue(role.roleName) || roleCode
    })
  }

  items.sort((left, right) =>
    left.roleName.localeCompare(right.roleName, 'zh-CN') || left.roleCode.localeCompare(right.roleCode))

  return {
    code: 0,
    data: { items }
  }
})
