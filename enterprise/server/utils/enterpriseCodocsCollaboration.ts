import { createError, getHeader, getQuery, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

const allowed = new Set(['category', 'scope', 'keyword', 'dept_code', 'owner_uid'])

export async function enterpriseCodocsCollaborationList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const raw = getQuery(event)
  const params = getRequestURL(event).searchParams
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key) || typeof value !== 'string' || params.getAll(key).length !== 1 || value.length > 1000) throw createError({ statusCode: 400, message: '协同文档筛选参数无效' })
    query[key] = value
  }
  query.category ||= 'shared'
  query.scope ||= 'all'
  if (!['shared', 'original', 'outside'].includes(query.category) || !['all', 'todo', 'initiated', 'participated', 'done'].includes(query.scope)) throw createError({ statusCode: 400, message: '协同文档筛选参数无效' })

  await prepareEnterpriseRuntime(event, 'codocs.collab-document-list')
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'view', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文档查看权限' })
  const admin = authorizationResourcesAllow(snapshot.resources, 'reviews', 'admin', snapshot.actionPolicies?.reviews)
  const operation = admin ? 'codocs.collab-document-list-admin' : 'codocs.collab-document-list'
  if (admin) await prepareEnterpriseRuntime(event, operation)
  const result = await callEnterpriseRuntime<{ success?: boolean, data?: { items?: unknown[], total?: number } }>(event, operation, {
    tenant: user.tenant, deployment: user.deployment, query,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'collab-documents', action: admin ? 'review-admin' : 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
  if (result?.success !== true || !Array.isArray(result.data?.items) || !Number.isSafeInteger(result.data.total) || Number(result.data.total) < 0) throw createError({ statusCode: 503, message: '协同文档响应无效' })
  return { code: 0, data: result.data }
}

// Stage B: opens (or joins) the v2 collaboration session for the verified
// user and returns their one-time admission ticket for Collab. Off unless both
// HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 and HZY_ENTERPRISE_CODOCS_COLLABORATION_V2
// are "true" (docs/Codocs-Document-Write-Coordination.md).
export function codocsCollaborationV2Enabled() {
  return process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 === 'true' && process.env.HZY_ENTERPRISE_CODOCS_COLLABORATION_V2 === 'true'
}

const operation = 'codocs.personal-document-collaboration-open' as const

export async function enterpriseCodocsCollaborationOpen(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (!codocsCollaborationV2Enabled()) throw createError({ statusCode: 404, message: '协作未启用', data: { code: 'collaboration_v2_disabled' } })
  const uuid = String(getRouterParam(event, 'uuid') || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(uuid) || getRequestURL(event).search) throw createError({ statusCode: 400, message: '协作请求无效' })
  // A ticket request has no body. Reject it from framing headers before any
  // potentially large body is buffered by Nitro.
  const contentLength = getHeader(event, 'content-length')
  if ((contentLength && contentLength !== '0') || getHeader(event, 'transfer-encoding')) throw createError({ statusCode: 400, message: '协作请求无效' })
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'edit', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文档编辑权限' })
  await prepareEnterpriseRuntime(event, operation)
  const response = await callEnterpriseRuntime<{ success?: boolean, data?: { sessionId?: unknown, ticket?: unknown, expiresAt?: unknown } }>(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
  const data = response?.data
  if (response?.success !== true || typeof data?.sessionId !== 'string' || typeof data.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(data.ticket)) {
    throw createError({ statusCode: 503, message: '协作会话响应无效' })
  }
  // The ticket is single-use and short-lived; it is handed only to this user.
  return { success: true, data: { token: `v2.${data.ticket}`, sessionId: data.sessionId, expiresAt: data.expiresAt } }
}
