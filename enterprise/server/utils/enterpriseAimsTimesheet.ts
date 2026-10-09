import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import { enterpriseAimsTimeEntryReviewRead } from './enterpriseAimsTimeEntryReviews'
import { timeEntryReadQuery } from '@hzy/foundation/shared/utils/timeEntryReadQuery'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { optionalReadPagination } from '@hzy/foundation/shared/utils/optionalReadPagination'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

// 工时与任务中心。
//
// 用户工时按 uid 读取，但 uid 只决定查询目标、不决定授权：可见性仍由
// Aims 依 current_user 与范围键判定，本层不据此放宽。

type TimesheetOperation
  = | 'aims.my-work-item-list'
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
const myWorkItemKeys = new Set(['filter', 'uid', 'projectId', 'project_id', 'search', 'tier', 'page', 'pageSize', 'status'])

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
  // 本人工时清单只允许读取已验证会话本人（Runtime 也以签名 actor 覆盖
  // current_user 并拒绝 uid != current_user）。先在宿主失败关闭，避免为
  // 他人 uid 签发许可。
  const selfTimeEntries = operation === 'aims.user-time-entry-list'
  if (selfTimeEntries && call.code !== user.uid) {
    throw createError({ statusCode: 403, message: '仅可查看本人工时' })
  }
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const resource = businessResource[operation]
  const action = write ? 'submit' : 'view'
  // manifest 的 aims:member / aims:dev 只有 timesheet:submit（填报本人工时），
  // 不含 view；填报页必须能读回本人已填记录。submit 只在本人清单上额外
  // 放行，不蕴含项目工时、汇总或他人工时的 view。
  const allows = (required: string) => authorizationResourcesAllow(authorization.resources, resource, required, authorization.actionPolicies?.[resource])
  if (!allows(action) && !(selfTimeEntries && allows('submit'))) {
    throw createError({ statusCode: 403, message: write ? '无工时编辑权限' : '无工时查看权限' })
  }
  const scopedWrite = operation === 'aims.project-time-entry-create' || operation === 'aims.project-time-entry-update' || operation === 'aims.project-time-entry-delete'
  const intentKey = scopedWrite ? text(getHeader(event, 'Idempotency-Key')) : call.idempotencyKey
  if (scopedWrite && !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/.test(intentKey || '')) throw createError({ statusCode: 400, message: 'Idempotency-Key 无效' })
  const projectWriteAuthorization = (scopedWrite || operation === 'aims.timesheet-week-submit')
    ? { ...await loadProjectCommandAuthorization(event, user, { resource: 'timesheet', action: 'submit', projectId: call.projectId || '', workItemId: '' }), objectId: '', subId: call.subId || '' }
    : undefined
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    ...(projectWriteAuthorization ? { projectWriteAuthorization } : {}),
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
  }, intentKey ? { idempotencyKey: intentKey } : {})
}

export async function enterpriseAimsMyWorkItems(event: H3Event) {
  const query = pickQuery(event, myWorkItemKeys, '工作项')
  try {
    optionalReadPagination(getQuery(event))
  } catch {
    throw createError({ statusCode: 400, message: '工作项分页参数无效' })
  }
  return await timesheetCall(event, 'aims.my-work-item-list', { query })
}

export async function enterpriseAimsTimeEntryReviews(event: H3Event) {
  return await enterpriseAimsTimeEntryReviewRead(event)
}

export async function enterpriseAimsTimeEntryReviewSubmit(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const projectId = requireID(event, 'id', '项目')
  const raw = await payloadOf(event)
  const action = raw.action
  const entries = raw.entries
  const reason = raw.reason
  if (Object.keys(raw).some(key => !['action', 'entries', 'reason'].includes(key)) || (action !== 'approve' && action !== 'return') || !Array.isArray(entries) || entries.length < 1 || entries.length > 100 || (reason !== undefined && (typeof reason !== 'string' || Array.from(reason).length > 1000)) || (action === 'return' && (typeof reason !== 'string' || !reason.trim())) || (action === 'approve' && reason !== undefined && reason !== '')) throw createError({ statusCode: 400, message: '工时审核请求无效' })
  let previous = 0
  const selected = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['id', 'rowVersion'].includes(key))) throw createError({ statusCode: 400, message: '工时审核记录无效' })
    const id = (entry as Record<string, unknown>).id
    const rowVersion = (entry as Record<string, unknown>).rowVersion
    if (!Number.isSafeInteger(id) || Number(id) <= previous || !Number.isSafeInteger(rowVersion) || Number(rowVersion) < 1) throw createError({ statusCode: 400, message: '工时审核记录无效' })
    previous = Number(id)
    return { id: Number(id), rowVersion: Number(rowVersion) }
  })
  const key = text(getHeader(event, 'Idempotency-Key'))
  if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/.test(key)) throw createError({ statusCode: 400, message: 'Idempotency-Key 无效' })
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'timesheet', 'approve', snapshot.actionPolicies?.timesheet)) throw createError({ statusCode: 403, message: '无工时审核权限' })
  const projectWriteAuthorization = { ...await loadProjectCommandAuthorization(event, user, { resource: 'timesheet', action: 'approve', projectId, workItemId: '' }), objectId: '', subId: '' }
  await prepareEnterpriseRuntime(event, 'aims.time-entry-review-submit')
  return await callEnterpriseRuntime(event, 'aims.time-entry-review-submit', {
    tenant: user.tenant, deployment: user.deployment, projectId,
    payload: { action, entries: selected, reason: action === 'return' ? String(reason).trim() : '' },
    projectWriteAuthorization,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'time-entry-reviews', action: 'approve', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: key })
}

export async function enterpriseAimsUserTimeEntries(event: H3Event) {
  const code = text(getRouterParam(event, 'uid'))
  if (!uidPattern.test(code)) throw createError({ statusCode: 400, message: '用户标识无效' })
  let query: Record<string, string>
  try {
    query = timeEntryReadQuery(getQuery(event), 'user')
  } catch {
    throw createError({ statusCode: 400, message: '工时筛选参数无效' })
  }
  return await timesheetCall(event, 'aims.user-time-entry-list', { code, query })
}

export async function enterpriseAimsProjectTimeEntryCreate(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  return await timesheetCall(event, 'aims.project-time-entry-create', { projectId, payload: await payloadOf(event) })
}

export async function enterpriseAimsProjectTimeEntryUpdate(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const subId = requireID(event, 'entryId', '工时记录')
  return await timesheetCall(event, 'aims.project-time-entry-update', {
    projectId, subId, payload: await payloadOf(event)
  })
}

export async function enterpriseAimsProjectTimeEntryDelete(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const subId = requireID(event, 'entryId', '工时记录')
  return await timesheetCall(event, 'aims.project-time-entry-delete', {
    projectId, subId
  })
}

export async function enterpriseAimsTimesheetWeekSubmit(event: H3Event) {
  const raw = text(getRouterParam(event, 'periodKey'))
  const code = raw.endsWith(':submit') ? raw.slice(0, -':submit'.length) : raw
  if (!periodPattern.test(code)) throw createError({ statusCode: 400, message: '周期标识无效' })
  return await timesheetCall(event, 'aims.timesheet-week-submit', {
    code, idempotencyKey: `timesheet-week-submit:${code}`
  })
}
