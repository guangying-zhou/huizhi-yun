import { createHash, randomUUID } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

// Internal only: UUID and path come from the ACL-checked Runtime metadata.
// Recheck the user's specific read/export action; do not make export depend on
// view or impersonate the standalone Codocs service identity.
export async function recordEnterpriseCodocsDocumentAccess(event: H3Event, uuid: string, path: string, permission: 'view' | 'export') {
  const operation = 'codocs.document-access-record' as const
  const user = await requireEnterpriseUser(event)
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', permission, snapshot.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: '缺少文档访问权限' })
  }
  const eventId = randomUUID()
  const result = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid,
    payload: { eventId, pathSha256: createHash('sha256').update(path).digest('hex') },
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'document-access-records', action: 'record', expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, { idempotencyKey: `codocs:access:${eventId}` }) as { success?: boolean, data?: { recorded?: boolean, id?: string } }
  if (result?.success !== true || result.data?.recorded !== true || result.data.id !== eventId) {
    throw createError({ statusCode: 503, message: '文档访问记录响应无效' })
  }
}
