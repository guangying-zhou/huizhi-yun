/**
 * 服务端权限检查工具。
 *
 * 与 `/api/auth/permissions` 共用 Console 本地 policy bundle 授权解析器。
 */
import type { H3Event } from 'h3'
import { appCode } from '~~/app/config/permissions'
import {
  hasPermissionInSnapshot,
  loadPolicyAuthorizationSnapshot
} from '~~/server/utils/policyAuthorization'
import {
  getAuthorizationSimulationPermissionRestriction
} from '~~/server/utils/authorizationSimulationRestrictions'
import {
  readAuthorizationSimulationSession,
  writeAuthorizationSimulationAudit
} from '~~/server/utils/authorizationSimulation'

type PermissionAction = string
interface CheckPermissionOptions {
  uid?: string
}

function simulationRestrictionMessage(resource: string, action: string) {
  return `模拟模式下禁止执行高风险操作：${resource}:${action}。请先退出模拟。`
}

function getActiveSimulationRestriction(event: H3Event, uid: string, resource: string, action: PermissionAction) {
  const simulation = readAuthorizationSimulationSession(event, uid)
  if (!simulation) return null

  const restriction = getAuthorizationSimulationPermissionRestriction(resource, action)
  if (!restriction) return null

  return {
    simulation,
    restriction
  }
}

/**
 * 检查当前请求用户是否拥有指定权限。
 */
export async function checkPermission(
  event: H3Event,
  resource: string,
  action: PermissionAction = 'admin',
  options: CheckPermissionOptions = {}
): Promise<boolean> {
  try {
    const uid = options.uid || await requireConsoleRequestUid(event)
    if (getActiveSimulationRestriction(event, uid, resource, action)) {
      return false
    }

    const snapshot = await loadPolicyAuthorizationSnapshot(uid, appCode, event)
    return hasPermissionInSnapshot(snapshot, resource, action)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[checkPermission] denied because policy authorization is unavailable: ${message}`)
    return false
  }
}

/**
 * 要求指定权限，无权限时抛出 403 错误。
 */
export async function requirePermission(
  event: H3Event,
  resource: string,
  action: PermissionAction = 'admin',
  message = '权限不足'
): Promise<void> {
  const uid = await requireConsoleRequestUid(event)
  const activeRestriction = getActiveSimulationRestriction(event, uid, resource, action)
  if (activeRestriction) {
    await writeAuthorizationSimulationAudit(event, {
      action: 'blocked',
      actorUid: uid,
      sessionId: activeRestriction.simulation.sid,
      mode: activeRestriction.simulation.mode,
      roleCode: activeRestriction.simulation.roleCode,
      subjectCode: activeRestriction.simulation.subjectCode,
      includeBaseline: activeRestriction.simulation.includeBaseline,
      reason: activeRestriction.simulation.reason,
      result: 'failed',
      failureReason: simulationRestrictionMessage(resource, action),
      resourceCode: activeRestriction.restriction.resourceCode,
      permissionAction: activeRestriction.restriction.action,
      restrictionReason: activeRestriction.restriction.reason,
      expiresAt: activeRestriction.simulation.expiresAt,
      policyBundleVersion: activeRestriction.simulation.policyBundleVersion,
      policyBundleHash: activeRestriction.simulation.policyBundleHash
    })
    throw createError({ statusCode: 403, message: simulationRestrictionMessage(resource, action) })
  }

  const allowed = await checkPermission(event, resource, action, { uid })
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}
