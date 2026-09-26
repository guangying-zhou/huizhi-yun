import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'

const operations = {
  create: { operation: 'codocs.personal-folder-create', capabilityAction: 'create', permission: 'create' },
  view: { operation: 'codocs.personal-folder-view', capabilityAction: 'read', permission: 'view' },
  update: { operation: 'codocs.personal-folder-update', capabilityAction: 'edit', permission: 'edit' },
  delete: { operation: 'codocs.personal-folder-delete', capabilityAction: 'delete', permission: 'edit' }
} as const

export async function enterpriseCodocsFolder(event: H3Event, action: keyof typeof operations) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const id = getRouterParam(event, 'id') || ''
  if ((action !== 'create' && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) || getRequestURL(event).search) {
    throw createError({ statusCode: 400, message: '目录标识或参数无效' })
  }
  const selected = operations[action]
  await prepareEnterpriseRuntime(event, selected.operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(authorization.resources, 'documents', selected.permission, authorization.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: '缺少文档目录权限' })
  }
  let payload: Record<string, unknown> | undefined
  if (action === 'update' || action === 'create') {
    payload = await readBody(event)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.keys(payload).length
      || Object.keys(payload).some(key => !(action === 'create' ? ['name', 'parent_id', 'folder_type', 'owner_uid'] : ['name', 'parent_id']).includes(key))) {
      throw createError({ statusCode: 400, message: '目录更新字段无效' })
    }
    if (action === 'create' && 'owner_uid' in payload) {
      if (payload.owner_uid !== user.uid) throw createError({ statusCode: 403, message: '不能为其他用户创建私人目录' })
      delete payload.owner_uid
    }
  }
  const creationKey = action === 'create' ? getHeader(event, 'idempotency-key') || '' : ''
  if (action === 'create' && !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(creationKey)) throw createError({ statusCode: 400, message: '创建目录需要有效的 Idempotency-Key' })
  const fingerprint = action === 'view' ? undefined : await hashServiceCommandPayload({ tenant: user.tenant, deployment: user.deployment, actor: user.uid, id, action, payload: payload || {} })
  return await callEnterpriseRuntime(event, selected.operation, {
    tenant: user.tenant, deployment: user.deployment, ...(action === 'create' ? {} : { objectId: id }),
    ...(payload ? { payload } : {}),
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'personal-folders', action: selected.capabilityAction, expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, action === 'create' ? { idempotencyKey: creationKey } : fingerprint ? { idempotencyKey: `codocs:folder:${fingerprint}` } : {})
}
