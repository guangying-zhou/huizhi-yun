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

// 工时与任务中心。
//
// 用户工时按 uid 读取，但 uid 只决定查询目标、不决定授权：可见性仍由
// Aims 依 current_user 与范围键判定，本层不据此放宽。

type TimesheetOperation =
  | 'aims.my-work-item-list'
  | 'aims.time-entry-review-list' | 'aims.time-entry-review-submit'
  | 'aims.user-time-entry-list'
  | 'aims.project-time-entry-create' | 'aims.project-time-entry-update' | 'aims.project-time-entry-delete'
  | 'aims.timesheet-week-submit'

const permitResource: Record<TimesheetOperation, string> = {
  'aims.my-work-item-list': 'my-work-items',
  'aims.time-entry-review-list': 'time-entry-reviews',
  'aims.time-entry-review-submit': 'time-entry-reviews',
  'aims.user-time-entry-list': 'user-time-entries',
  'aims.project-time-entry-create': 'project-time-entries',
  'aims.project-time-entry-update': 'project-time-entries',
  'aims.project-time-entry-delete': 'project-time-entries',
  'aims.timesheet-week-submit': 'timesheet-weeks'
}
const writeOperations = new Set<TimesheetOperation>([
  'aims.time-entry-review-submit', 'aims.project-time-entry-create',
  'aims.project-time-entry-update', 'aims.project-time-entry-delete', 'aims.timesheet-week-submit'
])
// 业务资源以 Aims manifest 为准：工作项读走 work_items，工时走 timesheet。
const businessResource: Record<TimesheetOperation, string> = {
  'aims.my-work-item-list': 'work_items',
  'aims.time-entry-review-list': 'timesheet',
  'aims.time-entry-review-submit': 'timesheet',
  'aims.user-time-entry-list': 'timesheet',
  'aims.project-time-entry-create': 'timesheet',
  'aims.project-time-entry-update': 'timesheet',
  'aims.project-time-entry-delete': 'timesheet',
  'aims.timesheet-week-submit': 'timesheet'
}

const numericID = /^[1-9]\d*$/
const uidPattern = /^[A-Za-z0-9._-]{1,64}$/
const periodPattern = /^\d{4}-W\d{2}$/
// 取自 Aims myWorkItems 的实际读取集合（work-items.vue 发送 filter + uid）。
// uid 安全：Aims 对 uid != current_user 返回 403，current_user 由运行时按已验签 actor 写入。
const myWorkItemKeys = new Set(['filter', 'uid', 'projectId', 'project_id', 'search', 'tier'])
const reviewKeys = new Set(['page', 'pageSize', 'status', 'cycleCode', 'uid'])
const userEntryKeys = new Set(['page', 'pageSize', 'startDate', 'endDate', 'projectId', 'cycleCode'])

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
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: '请求体无效' })
  }
  return body as Record<string, unknown>
}

interface TimesheetCall {
  projectId?: string
  subId?: string
  code?: string
  query?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function timesheetCall<T>(event: H3Event, operation: TimesheetOperation, call: TimesheetCall = {}): Promise<T> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const write = writeOperations.has(operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const resource = businessResource[operation]
  const action = write ? 'edit' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, resource, action, authorization.actionPolicies?.[resource])) {
    throw createError({ statusCode: 403, message: write ? '无工时编辑权限' : '无工时查看权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.projectId ? { projectId: call.projectId } : {}),
    ...(call.subId ? { subId: call.subId } : {}),
    ...(call.code ? { code: call.code } : {}),
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

export async function enterpriseAimsMyWorkItems(event: H3Event) {
  return await timesheetCall(event, 'aims.my-work-item-list', { query: pickQuery(event, myWorkItemKeys, '工作项') })
}

export async function enterpriseAimsTimeEntryReviews(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  return await timesheetCall(event, 'aims.time-entry-review-list', { projectId, query: pickQuery(event, reviewKeys, '工时评审') })
}

export async function enterpriseAimsTimeEntryReviewSubmit(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  return await timesheetCall(event, 'aims.time-entry-review-submit', { projectId, payload: await payloadOf(event) })
}

export async function enterpriseAimsUserTimeEntries(event: H3Event) {
  const code = text(getRouterParam(event, 'uid'))
  if (!uidPattern.test(code)) throw createError({ statusCode: 400, message: '用户标识无效' })
  return await timesheetCall(event, 'aims.user-time-entry-list', { code, query: pickQuery(event, userEntryKeys, '工时') })
}

export async function enterpriseAimsProjectTimeEntryCreate(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  return await timesheetCall(event, 'aims.project-time-entry-create', { projectId, payload: await payloadOf(event) })
}

export async function enterpriseAimsProjectTimeEntryUpdate(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const subId = requireID(event, 'entryId', '工时记录')
  return await timesheetCall(event, 'aims.project-time-entry-update', {
    projectId, subId, payload: await payloadOf(event), idempotencyKey: `time-entry-update:${projectId}:${subId}`
  })
}

export async function enterpriseAimsProjectTimeEntryDelete(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const subId = requireID(event, 'entryId', '工时记录')
  return await timesheetCall(event, 'aims.project-time-entry-delete', {
    projectId, subId, idempotencyKey: `time-entry-delete:${projectId}:${subId}`
  })
}

export async function enterpriseAimsTimesheetWeekSubmit(event: H3Event) {
  const raw = text(getRouterParam(event, 'periodKey'))
  const code = raw.endsWith(':submit') ? raw.slice(0, -':submit'.length) : raw
  if (!periodPattern.test(code)) throw createError({ statusCode: 400, message: '周期标识无效' })
  return await timesheetCall(event, 'aims.timesheet-week-submit', {
    code, payload: await payloadOf(event), idempotencyKey: `timesheet-week-submit:${code}`
  })
}
