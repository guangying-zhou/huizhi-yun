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

type DeliverableOperation
  = | 'aims.project-deliverable-list' | 'aims.project-deliverable-update'
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
  'documentUuid', 'document_uuid', 'page', 'pageSize'
])
const numericID = /^[1-9]\d*$/
const paginationKeys = new Set(['page', 'pageSize'])

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function paginationValue(key: string, raw: unknown) {
  if (typeof raw !== 'string' || !numericID.test(raw)) throw createError({ statusCode: 400, message: '分页参数无效' })
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || (key === 'pageSize' && value > 100)) throw createError({ statusCode: 400, message: '分页参数无效' })
  return raw
}

function releasePaginationQuery(event: H3Event) {
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!paginationKeys.has(key)) throw createError({ statusCode: 400, message: '项目版本筛选参数无效' })
    query[key] = paginationValue(key, raw)
  }
  return query
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
    if (paginationKeys.has(key)) {
      query[key] = paginationValue(key, raw)
      continue
    }
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '交付物筛选参数无效' })
    query[key] = value
  }
  return await deliverableCall(event, 'aims.project-deliverable-list', { query })
}

type RuntimeListRow = { id?: number | string }
type RuntimeListEnvelope = { code: number, data?: RuntimeListRow[] | { items?: RuntimeListRow[] } }

function listRows(envelope: RuntimeListEnvelope): RuntimeListRow[] {
  if (envelope.code !== 0) return []
  if (Array.isArray(envelope.data)) return envelope.data
  return Array.isArray(envelope.data?.items) ? envelope.data.items : []
}

export async function enterpriseAimsProjectDeliverableView(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const deliverableId = requireID(event, 'deliverableId', '交付物')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '交付物详情不接受筛选参数' })
  const response = await deliverableCall<RuntimeListEnvelope>(event, 'aims.project-deliverable-list', {
    query: { project_id: projectId, deliverable_id: deliverableId }
  })
  if (response.code !== 0) return response
  const item = listRows(response).find(row => String(row.id) === deliverableId)
  if (!item) throw createError({ statusCode: 404, message: '交付物不存在或不可访问' })
  return { code: 0, data: item }
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

// Narrow Host entry for a single existing matter. Runtime derives the project
// and manager relation from its signed actor; no body-supplied owner survives.
export async function enterpriseAimsMatterDeliverableCreate(event: H3Event) {
  const matterId = requireID(event, 'id', '工作项')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '添加成果不接受查询参数' })
  const body = await payloadOf(event)
  const keys = Object.keys(body)
  if (keys.some(key => !['name', 'description', 'acceptanceCriteria', 'deliverableType', 'required'].includes(key))) {
    throw createError({ statusCode: 400, message: '成果字段无效' })
  }
  const name = text(body.name)
  const deliverableType = text(body.deliverableType) || 'document'
  if (!name || name.length > 200 || !['document', 'code', 'artifact', 'task'].includes(deliverableType)
    || (body.required !== undefined && typeof body.required !== 'boolean')
    || (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000))
    || (body.acceptanceCriteria !== undefined && (typeof body.acceptanceCriteria !== 'string' || body.acceptanceCriteria.length > 2000))) {
    throw createError({ statusCode: 400, message: '成果内容无效' })
  }
  return await deliverableCall(event, 'aims.project-deliverable-batch-create', { payload: { items: [{
    entityType: 'matter', entityId: Number(matterId), name, deliverableType,
    required: body.required !== false,
    description: text(body.description), acceptanceCriteria: text(body.acceptanceCriteria)
  }] } })
}

export async function enterpriseAimsProjectReleases(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const query = releasePaginationQuery(event)
  return await deliverableCall(event, 'aims.project-release-list', { projectId, query })
}

// W1-A: existing Runtime release:list contains the version summary. The
// original page's features/items/logs require a separate delegated operation.
export async function enterpriseAimsProjectReleaseView(event: H3Event) {
  const projectId = requireID(event, 'id', '项目')
  const releaseId = requireID(event, 'releaseId', '版本')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '版本详情不接受筛选参数' })
  const response = await deliverableCall<RuntimeListEnvelope>(event, 'aims.project-release-list', { projectId })
  if (response.code !== 0) return response
  const item = listRows(response).find(row => String(row.id) === releaseId)
  if (!item) throw createError({ statusCode: 404, message: '版本不存在或不可访问' })
  return { code: 0, data: item }
}
