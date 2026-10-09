import { createError, type H3Event } from 'h3'
import { requireAimsSessionUid } from './authIdentity'
import { resolveAimsProjectAuthorizationObject } from './aimsScopedAuthorization'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { fetchUserDepartments } from './userDepartments'

// Source permission covers the whole AIMS project. Finance independently
// rechecks project_accounting:edit for this actor when executing each delivery.
export async function requireProductCostRulesProjectPermission(event: H3Event, projectId: string, projectCode: string) {
  if (!/^[1-9][0-9]*$/.test(projectId) || !Number.isSafeInteger(Number(projectId))
    || typeof projectCode !== 'string' || !projectCode.isWellFormed() || !projectCode
    || projectCode !== projectCode.trim() || [...projectCode].length > 50 || /[/\\\p{Cc}]/u.test(projectCode)) {
    throw createError({ statusCode: 400, message: '项目标识无效' })
  }
  const uid = await requireAimsSessionUid(event)
  // Do not turn a Directory outage into an empty department scope.
  const departments = await fetchUserDepartments(event, uid)
  const codes = new Set<string>()
  const collect = (nodes: Array<{ deptCode?: string, children?: Array<{ deptCode?: string }> }>) => {
    for (const node of nodes) {
      if (node.deptCode) codes.add(node.deptCode)
      if (node.children) collect(node.children)
    }
  }
  if (departments.primaryDeptCode) codes.add(departments.primaryDeptCode)
  collect(departments.departments || [])
  const object = await resolveAimsProjectAuthorizationObject(event, {
    projectId, uid, requireCompleteFacts: true,
    currentDeptCodes: [...codes], managementDeptCodes: departments.managedDeptCodes || []
  })
  if (object.actorUid !== uid || object.projectCode !== projectCode || String(object.projectId) !== projectId) {
    throw createError({ statusCode: 503, message: '项目授权事实与请求不一致' })
  }
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, uid, 'aims', {
    resourceCode: 'projects', action: 'edit', object
  })
  if (scoped.decision?.allowed !== true) {
    throw createError({ statusCode: 403, message: '需要该项目的编辑权限才能提交分摊规则' })
  }
  return { actorUid: uid, projectId, projectCode, resource: 'projects' as const, action: 'edit' as const }
}
