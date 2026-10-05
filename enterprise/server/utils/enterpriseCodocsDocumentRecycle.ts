import { createError, getHeader, getRequestURL, getRouterParam, readRawBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

export async function enterpriseCodocsDocumentRecycle(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const uuid = getRouterParam(event, 'uuid') || ''
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(uuid) || getRequestURL(event).search
    || !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)
    || Number(getHeader(event, 'content-length') || 0) > 0) {
    throw createError({ statusCode: 400, message: '回收请求只接受文档标识和有效的 Idempotency-Key' })
  }
  // hzy0 streams DELETE with chunked framing even when its body is empty.
  // Validate actual bytes; framing alone does not imply a payload.
  if (getHeader(event, 'transfer-encoding') && (await readRawBody(event))?.length) {
    throw createError({ statusCode: 400, message: '回收请求不接受请求体' })
  }
  const operation = 'codocs.personal-document-recycle' as const
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'delete', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文档删除权限' })
  return callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'delete', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: key })
}
