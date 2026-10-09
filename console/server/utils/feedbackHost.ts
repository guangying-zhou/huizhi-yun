import { readFeedbackImage } from './feedbackImageBody'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, setResponseStatus, type H3Event } from 'h3'
import { feedbackOperations, feedbackPermission, type FeedbackOperation } from '@hzy/foundation/server/utils/feedbackPermit'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import type { RuntimeScopedAuthorizationSnapshot } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

export async function executeFeedbackRequest(event: H3Event, op: FeedbackOperation, deps: {
  identity: () => Promise<{ uid: string, tenant: string, deployment: string }>
  authorize: (uid: string, resource: string, action: string) => Promise<RuntimeScopedAuthorizationSnapshot>
  call: (body: Record<string, unknown>, key?: string) => Promise<unknown>
}) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!feedbackOperations.includes(op)) throw createError({ statusCode: 404 })
  const user = await deps.identity()
  const write = ['attachment-put', 'draft', 'submit', 'retry', 'cancel', 'cleanup-media', 'settings-save'].includes(op)
  if (write && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const { resource, action } = feedbackPermission(op)
  const scoped = await deps.authorize(user.uid, resource, action)
  if (scoped.uid !== user.uid || scoped.appCode !== 'console' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision) || Number(scoped.policyRevision) < 0) throw createError({ statusCode: 503, message: '反馈权限暂不可用' })
  const input = { grants: scoped.grants, required: { appCode: 'console', resourceCode: resource, action }, policyOf: () => scoped.actionPolicy }
  const global = evaluateFoundationScopedAuthorization(input).allowed
  const self = evaluateFoundationScopedAuthorization({ ...input, object: { actorUid: user.uid, ownerUid: user.uid } }).allowed
  if (!self || (['admin-list', 'retry', 'cancel', 'cleanup-media', 'settings-get', 'settings-save'].includes(op) && !global)) throw createError({ statusCode: 403, message: '无权执行反馈操作' })
  if (write && scoped.authorizationMode !== 'merged') throw createError({ statusCode: 403, message: '请退出授权模拟后提交' })
  const raw: Record<string, unknown> = op === 'attachment-put' ? await readFeedbackImage(event) : write ? await readBody<Record<string, unknown>>(event) : getQuery(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const allowed = op === 'attachment-put' ? ['image', 'sha256', 'contentType'] : op === 'draft' ? ['text'] : op === 'settings-save' ? ['settings'] : op.endsWith('list') ? ['page', 'pageSize', 'status', 'kind'] : []
  if (Object.keys(raw).some(k => !allowed.includes(k))) throw createError({ statusCode: 400, message: '反馈参数无效' })
  const command = { ...raw, ...(op.endsWith('list') ? { page: Number(raw.page || 1), pageSize: Number(raw.pageSize || 20) } : {}), ...(op.startsWith('attachment-') ? { attachmentId: getRouterParam(event, 'attachmentId') || '' } : {}), ...(['attachment-put', 'attachment-read', 'detail', 'submit', 'retry', 'cancel', 'cleanup-media'].includes(op) ? { id: getRouterParam(event, 'id') || '' } : {}) }
  const key = write ? getHeader(event, 'idempotency-key') : undefined
  if (write && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400, message: '需要 Idempotency-Key' })
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt || 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503, message: '反馈权限已过期，请重试' })
  const response = await deps.call({ payload: JSON.stringify(command), authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action, operation: op, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, global } }, key)
  if (op === 'submit') setResponseStatus(event, 202)
  return response
}
