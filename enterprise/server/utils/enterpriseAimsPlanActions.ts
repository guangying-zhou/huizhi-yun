import { createError, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

// 项目计划页：模板版本、里程碑周期开启、需求目标。
//
// rollover 走 Aims 的 service 路径，rolloverProjectMilestone 不接收 query
// 也不做逐用户判定 —— 授权完全落在本层。独立应用的等价判定是
// assertRolloverWriteAccess：项目经理或该项目范围管理员。这里照搬，
// 先读项目详情拿到 currentUserRole / currentUserIsProjectAdmin 再决定。

type PlanOperation =
  | 'aims.project-template-version-list' | 'aims.project-template-version-view'
  | 'aims.milestone-rollover'
  | 'aims.requirement-target-create'

const permitResource: Record<PlanOperation, string> = {
  'aims.project-template-version-list': 'project-template-versions',
  'aims.project-template-version-view': 'project-template-versions',
  'aims.milestone-rollover': 'milestone-rollover',
  'aims.requirement-target-create': 'requirement-targets'
}

const numericID = /^[1-9]\d*$/
const projectCodePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const templateKeys = new Set(['page', 'pageSize', 'status', 'templateKey'])

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
function requireID(event: H3Event, param: string, label: string) {
  const value = text(getRouterParam(event, param))
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) {
    throw createError({ statusCode: 400, message: `${label}标识无效` })
  }
  return value
}
function pickQuery(event: H3Event, allowed: Set<string>, label: string) {
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!allowed.has(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: `${label}筛选参数无效` })
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: `${label}筛选参数无效` })
    query[key] = value
  }
  return query
}
async function payloadOf(event: H3Event) {
  const body = await readBody(event).catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

interface PlanCall {
  projectId?: string
  objectId?: string
  subId?: string
  code?: string
  query?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function planCall<T>(event: H3Event, operation: PlanOperation, call: PlanCall = {}, write = false): Promise<T> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const action = write ? 'edit' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'projects', action, authorization.actionPolicies?.projects)) {
    throw createError({ statusCode: 403, message: write ? '无项目编辑权限' : '无项目查看权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.projectId ? { projectId: call.projectId } : {}),
    ...(call.objectId ? { objectId: call.objectId } : {}),
    ...(call.subId ? { subId: call.subId } : {}),
    ...(call.code ? { code: call.code } : {}),
    query: { ...(call.query || {}), ...scope },
    ...(call.payload ? { payload: call.payload } : {}),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: permitResource[operation],
      action: operation === 'aims.milestone-rollover' ? 'execute' : (write ? 'edit' : 'view'),
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {})
}

export async function enterpriseAimsProjectTemplateVersions(event: H3Event) {
  return await planCall(event, 'aims.project-template-version-list', { query: pickQuery(event, templateKeys, '模板版本') })
}

export async function enterpriseAimsProjectTemplateVersion(event: H3Event) {
  const objectId = requireID(event, 'id', '模板版本')
  return await planCall(event, 'aims.project-template-version-view', { objectId })
}

export async function enterpriseAimsRequirementTargetCreate(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  return await planCall(event, 'aims.requirement-target-create', { projectId, payload: await payloadOf(event) }, true)
}

export async function enterpriseAimsMilestoneRollover(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const subId = requireID(event, 'milestoneId', '里程碑')
  const user = await requireEnterpriseUser(event)

  // Runtime 这条路径不做逐用户判定，因此项目角色必须在本层确认。
  const detail = await callEnterpriseRuntime<{ data?: Record<string, unknown> }>(event, 'aims.project-view', {
    tenant: user.tenant,
    deployment: user.deployment,
    projectId,
    query: await enterpriseAimsProjectScope(event, user.uid),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'projects',
      action: 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  })
  const project = (detail?.data || {}) as Record<string, unknown>
  const role = text(project.currentUserRole ?? project.current_user_role)
  const scopedAdmin = project.currentUserIsProjectAdmin === true || project.current_user_is_project_admin === 1
    || project.current_user_is_project_admin === '1' || project.currentUserIsProjectAdmin === 1
  if (role !== 'manager' && !scopedAdmin) {
    throw createError({ statusCode: 403, message: '仅项目经理或具备该项目范围管理权限的用户可以开启下一周期。' })
  }
  const code = text(project.projectCode ?? project.project_code)
  if (!projectCodePattern.test(code)) throw createError({ statusCode: 400, message: '项目编码无效' })

  return await planCall(event, 'aims.milestone-rollover', {
    code, subId, payload: await payloadOf(event), idempotencyKey: `milestone-rollover:${code}:${subId}`
  }, true)
}
