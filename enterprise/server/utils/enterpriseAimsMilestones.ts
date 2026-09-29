import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

// 里程碑：useMilestoneStore 的读写。对象归属仍由 Runtime 的
// requireProjectReadAccess / requireProjectUpdateAccess 判定。

type MilestoneOperation
  = | 'aims.project-milestone-list' | 'aims.project-milestone-create'
    | 'aims.project-milestone-update' | 'aims.project-milestone-delete'

const writeOperations = new Set<MilestoneOperation>([
  'aims.project-milestone-create', 'aims.project-milestone-update', 'aims.project-milestone-delete'
])
const listKeys = new Set(['page', 'pageSize', 'status'])
const numericID = /^[1-9]\d*$/
const intentKey = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/
const completionFields = new Set([
  'status', 'statusCode', 'status_code', 'lifecycleStatus', 'lifecycle_status',
  'completed', 'isCompleted', 'is_completed', 'completedAt', 'completed_at',
  'closed', 'isClosed', 'is_closed', 'closedAt', 'closed_at',
  'completionLockRequestId', 'completion_lock_request_id'
])

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

interface MilestoneCall {
  projectId?: string
  objectId?: string
  query?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function milestoneCall<T>(event: H3Event, operation: MilestoneOperation, call: MilestoneCall = {}): Promise<T> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const write = writeOperations.has(operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const action = write ? 'edit' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'projects', action, authorization.actionPolicies?.projects)) {
    throw createError({ statusCode: 403, message: write ? '无项目编辑权限' : '无项目查看权限' })
  }
  const projectWriteAuthorization = write ? { ...await loadProjectCommandAuthorization(event, user, { resource: 'projects', action: 'edit', projectId: call.projectId || '', workItemId: '' }), objectId: call.objectId || '', subId: '' } : undefined
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    ...(projectWriteAuthorization ? { projectWriteAuthorization } : {}),
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.projectId ? { projectId: call.projectId } : {}),
    ...(call.objectId ? { objectId: call.objectId } : {}),
    query: { ...(call.query || {}), ...scope },
    ...(call.payload ? { payload: call.payload } : {}),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'project-milestones',
      action: write ? 'edit' : 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {})
}

async function payloadOf(event: H3Event) {
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: '请求体无效' })
  }
  const payload = body as Record<string, unknown>
  if (Object.keys(payload).some(key => completionFields.has(key))) {
    throw createError({ statusCode: 400, message: '里程碑完成必须通过审批', data: { code: 'milestone_completion_workflow_required' } })
  }
  return payload
}

function requireIntentKey(event: H3Event) {
  const key = text(getHeader(event, 'Idempotency-Key'))
  if (!intentKey.test(key)) throw createError({ statusCode: 400, message: 'Idempotency-Key 无效' })
  return key
}

export async function enterpriseAimsProjectMilestones(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!listKeys.has(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: '里程碑筛选参数无效' })
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '里程碑筛选参数无效' })
    query[key] = value
  }
  return await milestoneCall(event, 'aims.project-milestone-list', { projectId, query })
}

export async function enterpriseAimsProjectMilestoneCreate(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const payload = await payloadOf(event)
  if (payload.mode === 'periodic') {
    throw createError({ statusCode: 400, message: '周期里程碑只能通过模板创建', data: { message: '周期里程碑只能通过模板创建' } })
  }
  return await milestoneCall(event, 'aims.project-milestone-create', { projectId, payload, idempotencyKey: requireIntentKey(event) })
}

export async function enterpriseAimsMilestoneUpdate(event: H3Event) {
  const objectId = requireID(event, 'id', '里程碑')
  const payload = await payloadOf(event)
  for (const key of ['startDate', 'start_date', 'endDate', 'end_date']) {
    if (typeof payload[key] === 'string' && !payload[key].trim()) {
      throw createError({ statusCode: 400, message: '里程碑日期无效', data: { code: 'invalid_milestone_date' } })
    }
  }
  return await milestoneCall(event, 'aims.project-milestone-update', {
    objectId, payload, idempotencyKey: requireIntentKey(event)
  })
}

export async function enterpriseAimsMilestoneDelete(event: H3Event) {
  const objectId = requireID(event, 'id', '里程碑')
  return await milestoneCall(event, 'aims.project-milestone-delete', {
    objectId, idempotencyKey: requireIntentKey(event)
  })
}
