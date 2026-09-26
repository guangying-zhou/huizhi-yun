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

// 里程碑：useMilestoneStore 的读写。对象归属仍由 Runtime 的
// requireProjectReadAccess / requireProjectUpdateAccess 判定。

type MilestoneOperation =
  | 'aims.project-milestone-list' | 'aims.project-milestone-create'
  | 'aims.project-milestone-update' | 'aims.project-milestone-delete'

const writeOperations = new Set<MilestoneOperation>([
  'aims.project-milestone-create', 'aims.project-milestone-update', 'aims.project-milestone-delete'
])
const listKeys = new Set(['page', 'pageSize', 'status'])
const numericID = /^[1-9]\d*$/

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
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
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
  return body as Record<string, unknown>
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
  return await milestoneCall(event, 'aims.project-milestone-create', { projectId, payload })
}

export async function enterpriseAimsMilestoneUpdate(event: H3Event) {
  const objectId = requireID(event, 'id', '里程碑')
  const payload = await payloadOf(event)
  return await milestoneCall(event, 'aims.project-milestone-update', {
    objectId, payload, idempotencyKey: `milestone-update:${objectId}`
  })
}

export async function enterpriseAimsMilestoneDelete(event: H3Event) {
  const objectId = requireID(event, 'id', '里程碑')
  return await milestoneCall(event, 'aims.project-milestone-delete', {
    objectId, idempotencyKey: `milestone-delete:${objectId}`
  })
}
