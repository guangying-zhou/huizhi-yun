import { createError, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'

const operation = 'codocs.personal-document-edit-metadata' as const
const fields = new Set(['title', 'folder_id', 'star_flag', 'home_flag', 'readonly_flag'])

export async function enterpriseCodocsDocumentMetadata(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const uuid = getRouterParam(event, 'uuid') || ''
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(uuid) || getRequestURL(event).search) {
    throw createError({ statusCode: 400, message: '文档标识或请求参数无效' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'edit', snapshot.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: '缺少文档编辑权限' })
  }
  const payload = await readBody<Record<string, unknown>>(event)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.keys(payload).length
    || Object.keys(payload).some(key => !fields.has(key))) {
    throw createError({ statusCode: 400, message: '文档元数据字段无效' })
  }
  const fingerprint = await hashServiceCommandPayload({ actor: user.uid, tenant: user.tenant, deployment: user.deployment, uuid, payload })
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid, payload,
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'personal-documents', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, { idempotencyKey: `codocs:metadata:${fingerprint}` })
}
