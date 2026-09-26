import { createError, getHeader, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

export async function enterpriseCodocsCabinetDelete(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const uuid = getRouterParam(event, 'uuid') || ''
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(uuid) || getRequestURL(event).search
    || !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)
    || Number(getHeader(event, 'content-length') || 0) > 0 || getHeader(event, 'transfer-encoding')) {
    throw createError({ statusCode: 400, message: '删除请求只接受文件标识和有效的 Idempotency-Key' })
  }
  const operation = 'codocs.personal-cabinet-delete' as const
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'delete', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文件删除权限' })
  const result = await callEnterpriseRuntime<{ success: boolean, data: { uuid: string, deleted: boolean } }>(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-cabinet', action: 'delete', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: key })
  if (result?.success !== true || result.data?.uuid !== uuid || result.data.deleted !== true) throw createError({ statusCode: 503, message: '文件删除结果不可用，请重试' })
  return result
}
