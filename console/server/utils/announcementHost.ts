import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { announcementOperations, announcementPermission, type AnnouncementOperation } from '@hzy/foundation/server/utils/announcementPermit'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import type { RuntimeScopedAuthorizationSnapshot } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

// Console-owned orchestration shared by its admin BFF and the Enterprise Host.
// Adapters inject trusted identity, current policy and transport; no self HTTP.
export async function executeAnnouncementRequest(event: H3Event, op: AnnouncementOperation, deps: {
  identity: () => Promise<{ uid: string, tenant: string, deployment: string }>
  authorize: (uid: string, action: string) => Promise<RuntimeScopedAuthorizationSnapshot>
  call: (body: Record<string, unknown>, key?: string) => Promise<unknown>
  commandOverride?: Record<string, unknown>
  keyOverride?: string
}) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!announcementOperations.includes(op)) throw createError({ statusCode: 404 })
  const user = await deps.identity()
  const write = ['save', 'withdraw', 'read', 'delivery-claim', 'delivery-ack', 'deliver'].includes(op)
  if (write && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = deps.commandOverride ?? (write ? await readBody<Record<string, unknown>>(event) : getQuery(event))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const allowed = op === 'save' ? ['id', 'title', 'body', 'level', 'startsAt', 'endsAt', 'audience', 'departments', 'popup', 'banner', 'bell', 'wecom', 'revision'] : op === 'deliver' ? (deps.commandOverride ? ['id'] : []) : op === 'delivery-claim' ? ['id'] : op === 'delivery-ack' ? ['id', 'delivery', 'success'] : op === 'withdraw' ? ['revision'] : op.endsWith('list') ? ['page'] : []
  if (Object.keys(raw).some(k => !allowed.includes(k))) throw createError({ statusCode: 400, message: '公告参数无效' })
  const command = { ...raw, ...(op.endsWith('list') ? { page: Number(raw.page || 1) } : {}), ...(!deps.commandOverride && ['detail', 'read', 'withdraw', 'deliver'].includes(op) ? { id: getRouterParam(event, 'id') || '' } : {}) }
  const key = deps.keyOverride ?? (write ? getHeader(event, 'idempotency-key') : undefined)
  if (write && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400, message: '需要 Idempotency-Key' })
  const action = announcementPermission(op)
  const scoped = await deps.authorize(user.uid, action)
  if (scoped.uid !== user.uid || scoped.appCode !== 'console' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision) || Number(scoped.policyRevision) < 0) throw createError({ statusCode: 503, message: '公告权限暂不可用' })
  if (!evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'console', resourceCode: 'announcements', action }, policyOf: () => scoped.actionPolicy }).allowed) throw createError({ statusCode: 403, message: '无权执行公告操作' })
  if (write && scoped.authorizationMode && scoped.authorizationMode !== 'merged') throw createError({ statusCode: 403, message: '请退出授权模拟后执行公告写入' })
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt || 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503, message: '公告权限已过期，请重试' })
  return deps.call({ payload: JSON.stringify(command), authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'announcements', action, operation: op, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision } }, key)
}
