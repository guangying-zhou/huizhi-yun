import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { fetchUserDepartments } from '../../../aims/server/utils/userDepartments'
import { resolveAimsProjectListAdminScopeQuery } from '../../../aims/server/utils/aimsScopedAuthorization'

type ProjectReadOperation = 'aims.project-list' | 'aims.project-view'

// includeArchived 与 lifecycleStatus 语义不同：前者在现有结果上并入归档项目，
// 后者是筛到单一状态。Aims 默认排除 archived，两者都需要显式传递。
// 以项目 store 实际发送的键为准：它在 fetchProjectPage 里把驼峰转成了蛇形
// （lifecycle_status / portfolio_id / participating_only）。驼峰保留为兼容入口。
const listQueryKeys = new Set([
  'page', 'pageSize', 'search', 'category', 'includeArchived',
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

async function projectRead(event: H3Event, operation: ProjectReadOperation, query: Record<string, string>, projectId = '') {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(projectId ? { projectId } : {}),
    query: { ...query, ...scope },
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'projects',
      action: 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  })
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
