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

// 第 2 批：交付物与项目版本。
//
// 交付物列表的可见性写在 SQL 里（Runtime 的 projectVisibilityWhere），
// 所以这里必须把服务端算出的范围一起传下去；缺了范围键，过滤条件为空。

type DeliverableOperation =
  | 'aims.project-deliverable-list' | 'aims.project-deliverable-update'
  | 'aims.project-deliverable-delete' | 'aims.project-deliverable-batch-create'
  | 'aims.project-release-list'

const permitResource: Record<DeliverableOperation, string> = {
  'aims.project-deliverable-list': 'project-deliverables',
  'aims.project-deliverable-update': 'project-deliverables',
  'aims.project-deliverable-delete': 'project-deliverables',
  'aims.project-deliverable-batch-create': 'project-deliverables',
  'aims.project-release-list': 'project-releases'
}

const writeOperations = new Set<DeliverableOperation>([
  'aims.project-deliverable-update', 'aims.project-deliverable-delete', 'aims.project-deliverable-batch-create'
])

// Aims listDeliverables 两种写法都认；调用方混用（plan.vue 发 project_id）。
const listKeys = new Set([
  'entityId', 'entity_id', 'entityType', 'entity_type',
  'projectId', 'project_id', 'status',
  'deliverableType', 'deliverable_type', 'deliverableId', 'deliverable_id',
  'documentUuid', 'document_uuid'
])
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

interface DeliverableCall {
  projectId?: string
  objectId?: string
  query?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function deliverableCall<T>(event: H3Event, operation: DeliverableOperation, call: DeliverableCall = {}): Promise<T> {
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
      resource: permitResource[operation],
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

export async function enterpriseAimsDeliverableList(event: H3Event) {
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!listKeys.has(key) || Array.isArray(raw)) {
      throw createError({ statusCode: 400, message: '交付物筛选参数无效' })
    }
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '交付物筛选参数无效' })
    query[key] = value
  }
  return await deliverableCall(event, 'aims.project-deliverable-list', { query })
}

export async function enterpriseAimsDeliverableUpdate(event: H3Event) {
  const objectId = requireID(event, 'id', '交付物')
  const payload = await payloadOf(event)
  return await deliverableCall(event, 'aims.project-deliverable-update', {
    objectId, payload, idempotencyKey: `deliverable-update:${objectId}`
  })
}

export async function enterpriseAimsDeliverableDelete(event: H3Event) {
  const objectId = requireID(event, 'id', '交付物')
  return await deliverableCall(event, 'aims.project-deliverable-delete', {
    objectId, idempotencyKey: `deliverable-delete:${objectId}`
  })
}

export async function enterpriseAimsDeliverableBatchCreate(event: H3Event) {
  const payload = await payloadOf(event)
  return await deliverableCall(event, 'aims.project-deliverable-batch-create', { payload })
}

export async function enterpriseAimsProjectReleases(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目版本不接受筛选参数' })
  return await deliverableCall(event, 'aims.project-release-list', { projectId })
}
