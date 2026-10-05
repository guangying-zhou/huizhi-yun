import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

// The operation names are added to Foundation's Enterprise runtime registry by
// the host integration. Keeping them together here makes the document-detail
// surface auditable and prevents a browser-selected runtime path.
const operations = {
  list: 'codocs.document-annotations-list',
  create: 'codocs.document-annotations-create',
  update: 'codocs.document-annotations-update',
  reply: 'codocs.document-annotation-reply-create',
  deleteReply: 'codocs.document-annotation-reply-delete'
} as const

type AnnotationAction = keyof typeof operations
type AnnotationBody = Record<string, unknown>

const uuidPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const idPattern = /^[1-9][0-9]{0,18}$/
const statuses = new Set(['open', 'resolved', 'deleted'])

function operationFor(action: AnnotationAction) {
  // The cast keeps this isolated branch buildable while the host registry is
  // being wired. The parent integration must register the exact five names
  // above in enterpriseRuntimeClient.ts before enabling the routes.
  return operations[action] as Parameters<typeof callEnterpriseRuntime>[1]
}

async function authorize(event: H3Event, action: AnnotationAction, permission: 'view' | 'edit') {
  const user = await requireEnterpriseUser(event)
  const operation = operationFor(action)
  await prepareEnterpriseRuntime(event, operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(authorization.resources, 'documents', permission, authorization.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: permission === 'view' ? '缺少文档批注查看权限' : '缺少文档批注编辑权限' })
  }
  return { user, operation }
}

function requireNoQuery(event: H3Event) {
  if (getRequestURL(event).search) throw createError({ statusCode: 400, message: '文档批注不接受查询参数' })
}

function requireUuid(event: H3Event) {
  const uuid = getRouterParam(event, 'uuid') || ''
  if (!uuidPattern.test(uuid)) throw createError({ statusCode: 400, message: '文档标识无效' })
  return uuid
}

function requireAnnotationId(event: H3Event) {
  const id = getRouterParam(event, 'id') || ''
  if (!idPattern.test(id)) throw createError({ statusCode: 400, message: '批注标识无效' })
  return id
}

function requireReplyId(event: H3Event) {
  const id = getRouterParam(event, 'replyId') || ''
  if (!idPattern.test(id)) throw createError({ statusCode: 400, message: '回复标识无效' })
  return id
}

function requireIdempotencyKey(event: H3Event) {
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '批注写入需要有效的 Idempotency-Key' })
  return key
}

function rejectUnknown(body: AnnotationBody, allowed: Set<string>) {
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !allowed.has(key))) {
    throw createError({ statusCode: 400, message: '文档批注字段无效' })
  }
}

function stringField(body: AnnotationBody, key: string, required = false, max = 10000) {
  const value = body[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || (required && !value.trim()) || [...value].length > max) {
    throw createError({ statusCode: 400, message: '文档批注字段无效' })
  }
  return value
}

function mentionsField(body: AnnotationBody) {
  if (body.mentioned_users === undefined) return []
  if (!Array.isArray(body.mentioned_users) || body.mentioned_users.length > 100) throw createError({ statusCode: 400, message: '文档批注提及用户无效' })
  return body.mentioned_users
}

function statusField(body: AnnotationBody) {
  const status = stringField(body, 'status', true, 16)
  if (!statuses.has(status!)) throw createError({ statusCode: 400, message: '批注状态无效' })
  return status!
}

function errorResponse(error: unknown, fallback: string): never {
  const err = error as { statusCode?: number, message?: string }
  throw createError({ statusCode: err?.statusCode || 500, message: err?.message || fallback })
}

export async function enterpriseCodocsAnnotationsList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  requireNoQuery(event)
  const uuid = requireUuid(event)
  try {
    const { user, operation } = await authorize(event, 'list', 'view')
    return await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, code: uuid,
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'document-annotations', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
    })
  } catch (error) { return errorResponse(error, '读取文档批注失败') }
}

export async function enterpriseCodocsAnnotationCreate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  requireNoQuery(event)
  const uuid = requireUuid(event)
  const key = requireIdempotencyKey(event)
  try {
    const { user, operation } = await authorize(event, 'create', 'edit')
    const body = await readBody<AnnotationBody>(event) || {}
    rejectUnknown(body, new Set(['selected_text', 'context_before', 'context_after', 'position_hint', 'content', 'mentioned_users']))
    const selectedText = stringField(body, 'selected_text', true)
    const content = stringField(body, 'content', true)
    const contextBefore = stringField(body, 'context_before') || ''
    const contextAfter = stringField(body, 'context_after') || ''
    const position = body.position_hint === undefined ? 0 : body.position_hint
    if (!Number.isSafeInteger(position) || Number(position) < 0) throw createError({ statusCode: 400, message: '批注位置无效' })
    return await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, code: uuid,
      payload: { selected_text: selectedText, context_before: contextBefore, context_after: contextAfter, position_hint: position, content, mentioned_users: mentionsField(body) },
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'document-annotations', action: 'create', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }, { idempotencyKey: key })
  } catch (error) { return errorResponse(error, '创建文档批注失败') }
}

export async function enterpriseCodocsAnnotationUpdate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  requireNoQuery(event)
  const uuid = requireUuid(event); const id = requireAnnotationId(event); const key = requireIdempotencyKey(event)
  try {
    const { user, operation } = await authorize(event, 'update', 'edit')
    const body = await readBody<AnnotationBody>(event) || {}
    rejectUnknown(body, new Set(['status']))
    const status = statusField(body)
    return await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, code: uuid, objectId: id,
      payload: { status }, authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'document-annotations', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }, { idempotencyKey: key })
  } catch (error) { return errorResponse(error, '更新文档批注失败') }
}

export async function enterpriseCodocsAnnotationReply(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  requireNoQuery(event)
  const uuid = requireUuid(event); const id = requireAnnotationId(event); const key = requireIdempotencyKey(event)
  try {
    const { user, operation } = await authorize(event, 'reply', 'edit')
    const body = await readBody<AnnotationBody>(event) || {}
    rejectUnknown(body, new Set(['content', 'mentioned_users']))
    const content = stringField(body, 'content', true)
    return await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, code: uuid, objectId: id,
      payload: { content, mentioned_users: mentionsField(body) }, authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'document-annotations', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }, { idempotencyKey: key })
  } catch (error) { return errorResponse(error, '创建批注回复失败') }
}

export async function enterpriseCodocsAnnotationReplyDelete(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  requireNoQuery(event)
  const uuid = requireUuid(event); const id = requireAnnotationId(event); const replyId = requireReplyId(event); const key = requireIdempotencyKey(event)
  try {
    const { user, operation } = await authorize(event, 'deleteReply', 'edit')
    return await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, code: uuid, objectId: id, subId: replyId,
      payload: {}, authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'document-annotations', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }, { idempotencyKey: key })
  } catch (error) { return errorResponse(error, '删除批注回复失败') }
}
