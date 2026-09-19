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

// 工作项细化与执行（第一批）：评论、提交、文档、工时、执行上下文、分解、
// 交付物与批量更新，全部委托给 Runtime 的既有 Aims handler。
//
// 这里只做两件本层该做的事：按 work_items 的用户授权判定 view/edit，以及把
// 短期 permit 绑到当前会话 actor。数据范围由 enterpriseAimsProjectScope 在
// 服务端算出，Runtime 端还会再按白名单过滤并用已验签 actor 覆盖 current_user。

type WorkspaceOperation =
  | 'aims.work-item-comment-list' | 'aims.work-item-comment-create'
  | 'aims.work-item-commit-list' | 'aims.work-item-commit-link' | 'aims.work-item-commit-unlink'
  | 'aims.work-item-document-list' | 'aims.work-item-document-link'
  | 'aims.work-item-document-unlink' | 'aims.work-item-document-unlink-current'
  | 'aims.work-item-time-entry-list' | 'aims.work-item-time-entry-create'
  | 'aims.work-item-time-entry-update' | 'aims.work-item-time-entry-delete'
  | 'aims.work-item-transitions' | 'aims.work-item-execution-context'
  | 'aims.work-item-source-sections' | 'aims.work-item-decompose-context' | 'aims.work-item-children'
  | 'aims.work-item-decompose-submit' | 'aims.work-item-clone-from-template'
  | 'aims.work-item-deliverable-update' | 'aims.work-item-batch-update'

// permit.resource 必须与 Runtime spec 的 Resource 完全一致，否则 permit 校验失败。
const permitResource: Record<WorkspaceOperation, string> = {
  'aims.work-item-comment-list': 'work-item-comments',
  'aims.work-item-comment-create': 'work-item-comments',
  'aims.work-item-commit-list': 'work-item-commits',
  'aims.work-item-commit-link': 'work-item-commits',
  'aims.work-item-commit-unlink': 'work-item-commits',
  'aims.work-item-document-list': 'work-item-documents',
  'aims.work-item-document-link': 'work-item-documents',
  'aims.work-item-document-unlink': 'work-item-documents',
  'aims.work-item-document-unlink-current': 'work-item-documents',
  'aims.work-item-time-entry-list': 'work-item-time-entries',
  'aims.work-item-time-entry-create': 'work-item-time-entries',
  'aims.work-item-time-entry-update': 'work-item-time-entries',
  'aims.work-item-time-entry-delete': 'work-item-time-entries',
  'aims.work-item-transitions': 'work-item-execution',
  'aims.work-item-execution-context': 'work-item-execution',
  'aims.work-item-source-sections': 'work-item-execution',
  'aims.work-item-decompose-context': 'work-item-execution',
  'aims.work-item-children': 'work-item-execution',
  'aims.work-item-decompose-submit': 'work-item-decomposition',
  'aims.work-item-clone-from-template': 'work-item-decomposition',
  'aims.work-item-deliverable-update': 'work-item-deliverables',
  'aims.work-item-batch-update': 'work-item-batch'
}

const writeOperations = new Set<WorkspaceOperation>([
  'aims.work-item-comment-create',
  'aims.work-item-commit-link', 'aims.work-item-commit-unlink',
  'aims.work-item-document-link', 'aims.work-item-document-unlink', 'aims.work-item-document-unlink-current',
  'aims.work-item-time-entry-create', 'aims.work-item-time-entry-update', 'aims.work-item-time-entry-delete',
  'aims.work-item-decompose-submit', 'aims.work-item-clone-from-template',
  'aims.work-item-deliverable-update', 'aims.work-item-batch-update'
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

function rejectQuery(event: H3Event, label: string) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: `${label}不接受筛选参数` })
}

interface WorkspaceCall {
  objectId?: string
  subId?: string
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function workspaceCall<T>(event: H3Event, operation: WorkspaceOperation, call: WorkspaceCall = {}): Promise<T> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const write = writeOperations.has(operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const action = write ? 'edit' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'work_items', action, authorization.actionPolicies?.work_items)) {
    throw createError({ statusCode: 403, message: write ? '无工作项编辑权限' : '无工作项查看权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.objectId ? { objectId: call.objectId } : {}),
    ...(call.subId ? { subId: call.subId } : {}),
    query: scope,
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

// 写操作的幂等键由稳定业务键派生：同一 actor 对同一对象的同一动作重放不产生第二条记录。
function idempotencyKey(operation: WorkspaceOperation, objectId: string, subId = '') {
  return [operation, objectId, subId].filter(Boolean).join(':')
}

function readEndpoint(operation: WorkspaceOperation, label: string) {
  return async (event: H3Event) => {
    const id = requireID(event, 'id', '工作项')
    rejectQuery(event, label)
    return await workspaceCall(event, operation, { objectId: id })
  }
}

export const enterpriseAimsWorkItemComments = readEndpoint('aims.work-item-comment-list', '工作项评论')
export const enterpriseAimsWorkItemCommits = readEndpoint('aims.work-item-commit-list', '工作项提交')
export const enterpriseAimsWorkItemDocuments = readEndpoint('aims.work-item-document-list', '工作项文档')
export const enterpriseAimsWorkItemTimeEntries = readEndpoint('aims.work-item-time-entry-list', '工作项工时')
export const enterpriseAimsWorkItemTransitions = readEndpoint('aims.work-item-transitions', '工作项状态流转')
export const enterpriseAimsWorkItemExecutionContext = readEndpoint('aims.work-item-execution-context', '工作项执行上下文')
export const enterpriseAimsWorkItemSourceSections = readEndpoint('aims.work-item-source-sections', '工作项源章节')
export const enterpriseAimsWorkItemDecomposeContext = readEndpoint('aims.work-item-decompose-context', '工作项分解上下文')
export const enterpriseAimsWorkItemChildren = readEndpoint('aims.work-item-children', '工作项子项')

function writeEndpoint(operation: WorkspaceOperation, options: { sub?: string, body?: boolean } = {}) {
  return async (event: H3Event) => {
    const id = requireID(event, 'id', '工作项')
    const subId = options.sub ? requireID(event, options.sub, '关联对象') : undefined
    const payload = options.body ? await payloadOf(event) : undefined
    return await workspaceCall(event, operation, { objectId: id, subId, payload, idempotencyKey: idempotencyKey(operation, id, subId) })
  }
}

export const enterpriseAimsWorkItemCommentCreate = writeEndpoint('aims.work-item-comment-create', { body: true })
export const enterpriseAimsWorkItemCommitLink = writeEndpoint('aims.work-item-commit-link', { body: true })
export const enterpriseAimsWorkItemCommitUnlink = writeEndpoint('aims.work-item-commit-unlink', { sub: 'commitId' })
export const enterpriseAimsWorkItemDocumentLink = writeEndpoint('aims.work-item-document-link', { body: true })
export const enterpriseAimsWorkItemDocumentUnlink = writeEndpoint('aims.work-item-document-unlink', { sub: 'documentId' })
export const enterpriseAimsWorkItemDocumentUnlinkCurrent = writeEndpoint('aims.work-item-document-unlink-current')
export const enterpriseAimsWorkItemTimeEntryCreate = writeEndpoint('aims.work-item-time-entry-create', { body: true })
export const enterpriseAimsWorkItemTimeEntryUpdate = writeEndpoint('aims.work-item-time-entry-update', { sub: 'entryId', body: true })
export const enterpriseAimsWorkItemTimeEntryDelete = writeEndpoint('aims.work-item-time-entry-delete', { sub: 'entryId' })
export const enterpriseAimsWorkItemDecomposeSubmit = writeEndpoint('aims.work-item-decompose-submit', { body: true })
export const enterpriseAimsWorkItemCloneFromTemplate = writeEndpoint('aims.work-item-clone-from-template', { body: true })
export const enterpriseAimsWorkItemDeliverableUpdate = writeEndpoint('aims.work-item-deliverable-update', { sub: 'deliverableId', body: true })

export async function enterpriseAimsWorkItemBatchUpdate(event: H3Event) {
  const payload = await payloadOf(event)
  return await workspaceCall(event, 'aims.work-item-batch-update', { payload })
}
