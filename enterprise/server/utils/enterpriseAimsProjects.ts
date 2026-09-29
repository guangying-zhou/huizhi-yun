import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime, loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { loadProjectWriteAuthorization, projectWriteDiscoveryAllows } from '@hzy/foundation/server/utils/projectWriteAuthorization'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { compileFoundationProjectScope } from '@hzy/foundation/server/utils/projectScopeAuthorization'
import { optionalReadPagination } from '@hzy/foundation/shared/utils/optionalReadPagination'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { fetchUserDepartments } from '../../../aims/server/utils/userDepartments'
import { resolveAimsProjectListAdminScopeQuery, resolveAimsProjectAuthorizationObject } from '../../../aims/server/utils/aimsScopedAuthorization'

type ProjectReadOperation = 'aims.project-list' | 'aims.project-view'

// includeArchived 与 lifecycleStatus 语义不同：前者在现有结果上并入归档项目，
// 后者是筛到单一状态。Aims 默认排除 archived，两者都需要显式传递。
// 以项目 store 实际发送的键为准：它在 fetchProjectPage 里把驼峰转成了蛇形
// （lifecycle_status / portfolio_id / participating_only）。驼峰保留为兼容入口。
const listQueryKeys = new Set([
  'favoritesOnly', 'rootSearch', 'rootStatus', 'rootCategory', 'projection', 'page', 'pageSize', 'search', 'category', 'includeArchived',
  'lifecycle_status', 'portfolio_id', 'participating_only', 'domain_code', 'dept_code', 'leader_uid',
  'lifecycleStatus', 'portfolioId', 'participatingOnly'
])
const projectID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function collectDepartmentCodes(nodes: Array<{ deptCode?: string, children?: unknown[] }>, result = new Set<string>()) {
  for (const node of nodes) {
    const code = text(node.deptCode)
    if (code) result.add(code)
    if (Array.isArray(node.children)) collectDepartmentCodes(node.children as Array<{ deptCode?: string, children?: unknown[] }>, result)
  }
  return result
}

function listInput(event: H3Event) {
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!listQueryKeys.has(key) || Array.isArray(raw)) {
      throw createError({ statusCode: 400, message: '项目筛选参数无效' })
    }
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '项目筛选参数无效' })
    result[key] = value
  }
  try {
    Object.assign(result, optionalReadPagination(getQuery(event)))
  } catch {
    throw createError({ statusCode: 400, message: '项目分页参数无效' })
  }
  if (result.projection && !['projects', 'portfolios', 'candidates', 'switcher'].includes(result.projection)) throw createError({ statusCode: 400, message: '项目投影无效' })
  if (!result.projection && (result.page || result.pageSize)) result.projection = 'projects'
  if (result.projection) {
    result.page ||= '1'
    result.pageSize ||= '20'
  }
  return result
}

export async function enterpriseAimsProjectScope(event: H3Event, uid: string) {
  const departments = await fetchUserDepartments(event, uid)
  const deptCodes = [...collectDepartmentCodes(departments.departments)]
  const managementDeptCodes = [...new Set(departments.managedDeptCodes.map(code => text(code)).filter(Boolean))]
  const adminScope = await resolveAimsProjectListAdminScopeQuery(event, uid, { deptCodes, managementDeptCodes })
  return {
    ...(deptCodes.length ? { current_user_dept_codes: deptCodes.join(',') } : {}),
    ...(managementDeptCodes.length ? { current_user_management_dept_codes: managementDeptCodes.join(',') } : {}),
    ...adminScope
  }
}

export async function enterpriseAimsProjectReadPermit(event: H3Event, user: { uid: string, tenant: string, deployment: string }) {
  // Resource gate before any permit is issued: the Runtime then applies Aims'
  // object visibility and scoped-admin data scope. A Console dependency
  // failure propagates as 503 and is never reported as a missing permission.
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'projects', 'view', authorization.actionPolicies?.projects)) {
    throw createError({ statusCode: 403, message: '无项目查看权限' })
  }
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'projects', action: 'view' })
  const hasViewPermission = evaluateFoundationScopedAuthorization({ grants: scoped.grants.map(grant => ({ ...grant, scopes: [], defaultScopes: [], assignmentScopes: [] })), required: { appCode: 'aims', resourceCode: 'projects', action: 'view' }, policyOf: () => scoped.actionPolicy }).allowed
  if (!hasViewPermission) throw createError({ statusCode: 403, message: '无项目查看权限' })
  const projection = compileFoundationProjectScope({ grants: scoped.grants, required: { appCode: 'aims', resourceCode: 'projects', action: 'view' }, policyOf: () => scoped.actionPolicy }, user.uid)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (!projection || scoped.uid !== user.uid || scoped.appCode !== 'aims' || !scoped.bundleVersion || !scoped.bundleHash
    || !Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(scoped.policyRevision) || scoped.policyRevision! < 0 || expiresAt <= Date.now()) {
    throw createError({ statusCode: 503, message: '项目范围授权暂不可用' })
  }
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return {
    query: scope,
    authorization: {
      canManagePortfolios: authorizationResourcesAllow(authorization.resources, 'portfolios', 'admin', authorization.actionPolicies?.portfolios),
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'projects',
      action: 'view',
      hasViewPermission,
      expiresAt,
      scope: projection,
      bundleVersion: scoped.bundleVersion,
      bundleHash: scoped.bundleHash,
      policyRevision: scoped.policyRevision
    }
  }
}

export async function projectRead(event: H3Event, operation: ProjectReadOperation, query: Record<string, string>, projectId = '') {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const permit = await enterpriseAimsProjectReadPermit(event, user)
  await prepareEnterpriseRuntime(event, operation)
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(projectId ? { projectId } : {}),
    query: { ...query, ...permit.query },
    authorization: permit.authorization
  })
  if (operation === 'aims.project-view' && result.code === 0) {
    const object = await resolveAimsProjectAuthorizationObject(event, { projectId, uid: user.uid }, async () => result.data)
    const permit = await loadProjectWriteAuthorization(event, user, projectId, object, { resource: 'projects', action: 'edit' })
    return { ...result, data: { ...result.data, canEditProject: projectWriteDiscoveryAllows(permit.allowed, result.data.current_user_role ?? result.data.currentUserRole) } }
  }
  return result
}

export async function enterpriseAimsProjectList(event: H3Event) {
  return await projectRead(event, 'aims.project-list', listInput(event))
}

export async function enterpriseAimsProjectView(event: H3Event) {
  const id = text(getRouterParam(event, 'id'))
  if (!projectID.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400, message: '项目标识无效' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目详情不接受筛选参数' })
  return await projectRead(event, 'aims.project-view', {}, id)
}

export async function enterpriseAimsNestedProjectReadPermit(event: H3Event, user: { uid: string, tenant: string, deployment: string }, projectId: string) {
  const permit = await enterpriseAimsProjectReadPermit(event, user)
  return { query: permit.query, authorization: { ...permit.authorization, projectId } }
}
