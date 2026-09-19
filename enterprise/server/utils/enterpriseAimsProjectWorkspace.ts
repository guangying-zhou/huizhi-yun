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

// 第 0 批：项目线共享依赖（收藏、仓库、项目工作项列表）。
//
// 这三组是 useProjectStore 与 ProjectNavbar 的前提，18 个项目页共用。
// 收藏是"我的"数据，按 projects:view 判定即可；仓库读写按 projects 的
// view/edit 判定，对象级归属仍由 Runtime 侧的 Aims handler 执行。

type WorkspaceOperation =
  | 'aims.project-favorite-list' | 'aims.project-favorite-add' | 'aims.project-favorite-remove'
  | 'aims.project-repo-list' | 'aims.project-repo-link' | 'aims.project-repo-unlink'
  | 'aims.project-work-item-list' | 'aims.project-routine-review'

const permitResource: Record<WorkspaceOperation, string> = {
  'aims.project-favorite-list': 'project-favorites',
  'aims.project-favorite-add': 'project-favorites',
  'aims.project-favorite-remove': 'project-favorites',
  'aims.project-repo-list': 'project-repos',
  'aims.project-repo-link': 'project-repos',
  'aims.project-repo-unlink': 'project-repos',
  'aims.project-work-item-list': 'project-work-items',
  'aims.project-routine-review': 'project-routine-review'
}

const writeOperations = new Set<WorkspaceOperation>([
  'aims.project-favorite-add', 'aims.project-favorite-remove',
  'aims.project-repo-link', 'aims.project-repo-unlink'
])

// 调用方混用驼峰与蛇形（plan.vue 发 milestone_id），Aims 两种都认，这里同样放行。
const workItemListKeys = new Set([
  'page', 'pageSize', 'page_size', 'view', 'type', 'tier', 'status', 'priority', 'search',
  'milestoneId', 'milestone_id', 'assigneeUid', 'assignee_uid',
  'customerCode', 'customer_code', 'environmentCode', 'environment_code',
  'slaStatusSnapshot', 'sla_status_snapshot', 'slaStatus'
])
const numericID = /^[1-9]\d*$/
const repoProjectCode = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function requireProjectID(event: H3Event) {
  const value = text(getRouterParam(event, 'id'))
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) {
    throw createError({ statusCode: 400, message: '项目标识无效' })
  }
  return value
}

interface WorkspaceCall {
  projectId?: string
  query?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function workspaceCall<T>(event: H3Event, operation: WorkspaceOperation, call: WorkspaceCall = {}): Promise<T> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const write = writeOperations.has(operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const action = write ? 'edit' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'projects', action, authorization.actionPolicies?.projects)) {
    throw createError({ statusCode: 403, message: write ? '无项目编辑权限' : '无项目查看权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  // 收藏是当前用户自己的记录，不需要项目数据范围；其余按已验证会话计算。
  const scope = call.projectId ? await enterpriseAimsProjectScope(event, user.uid) : {}
  return await callEnterpriseRuntime<T>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.projectId ? { projectId: call.projectId } : {}),
    query: { ...(call.query || {}), ...scope },
    ...(call.payload ? { payload: call.payload } : {}),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: permitResource[operation],
      action: write ? 'edit' : 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {})
}

// 与独立应用的既有契约一致：新增走请求体，取消走 query 参数，
// 且 projectId 是数字而不是字符串（aims/app/stores/project.ts toggleFavorite）。
function favoriteProjectID(raw: unknown) {
  const value = typeof raw === 'number' ? String(raw) : (typeof raw === 'string' ? raw.trim() : '')
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) {
    throw createError({ statusCode: 400, message: '收藏的项目标识无效' })
  }
  return value
}

async function favoriteProjectFromBody(event: H3Event) {
  const body = await readBody(event) as Record<string, unknown> | null
  return favoriteProjectID(body?.projectId ?? body?.project_id)
}

function favoriteProjectFromQuery(event: H3Event) {
  const query = getQuery(event)
  return favoriteProjectID(query.projectId ?? query.project_id)
}

export async function enterpriseAimsProjectFavorites(event: H3Event) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目收藏不接受筛选参数' })
  return await workspaceCall(event, 'aims.project-favorite-list')
}

export async function enterpriseAimsProjectFavoriteAdd(event: H3Event) {
  const projectId = await favoriteProjectFromBody(event)
  return await workspaceCall(event, 'aims.project-favorite-add', {
    payload: { projectId }, idempotencyKey: `favorite-add:${projectId}`
  })
}

export async function enterpriseAimsProjectFavoriteRemove(event: H3Event) {
  const projectId = favoriteProjectFromQuery(event)
  return await workspaceCall(event, 'aims.project-favorite-remove', {
    payload: { projectId }, idempotencyKey: `favorite-remove:${projectId}`
  })
}

export async function enterpriseAimsProjectRepos(event: H3Event) {
  const projectId = requireProjectID(event)
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目仓库不接受筛选参数' })
  return await workspaceCall(event, 'aims.project-repo-list', { projectId })
}

export async function enterpriseAimsProjectRepoLink(event: H3Event) {
  const projectId = requireProjectID(event)
  const body = await readBody(event)
  const code = text((body as Record<string, unknown> | null)?.repoProjectCode)
  if (!repoProjectCode.test(code)) throw createError({ statusCode: 400, message: '仓库标识无效' })
  return await workspaceCall(event, 'aims.project-repo-link', {
    projectId, payload: { repoProjectCode: code }, idempotencyKey: `repo-link:${projectId}:${code}`
  })
}

export async function enterpriseAimsProjectRepoUnlink(event: H3Event) {
  const projectId = requireProjectID(event)
  const code = text(getQuery(event).repoProjectCode)
  if (!repoProjectCode.test(code)) throw createError({ statusCode: 400, message: '仓库标识无效' })
  return await workspaceCall(event, 'aims.project-repo-unlink', {
    projectId, query: { repoProjectCode: code }, idempotencyKey: `repo-unlink:${projectId}:${code}`
  })
}

export async function enterpriseAimsProjectWorkItems(event: H3Event) {
  const projectId = requireProjectID(event)
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!workItemListKeys.has(key) || Array.isArray(raw)) {
      throw createError({ statusCode: 400, message: '项目工作项筛选参数无效' })
    }
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '项目工作项筛选参数无效' })
    query[key] = value
  }
  return await workspaceCall(event, 'aims.project-work-item-list', { projectId, query })
}

export async function enterpriseAimsProjectRoutineReview(event: H3Event) {
  const projectId = requireProjectID(event)
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '季度评审不接受筛选参数' })
  return await workspaceCall(event, 'aims.project-routine-review', { projectId })
}
