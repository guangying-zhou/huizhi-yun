import { createError, getQuery, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

const operations = {
  'check-name': 'codocs.personal-document-check-name',
  list: 'codocs.personal-document-list',
  view: 'codocs.personal-document-view',
  download: 'codocs.personal-document-download',
  trash: 'codocs.personal-document-trash',
  folders: 'codocs.personal-folder-list'
} as const

export async function enterpriseCodocsDocumentRead(event: H3Event, action: keyof typeof operations) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const operation = operations[action]
  // Token acquisition can be slow. Resolve it before reading the current user
  // policy so the short permit is not minted from a snapshot held across it.
  await prepareEnterpriseRuntime(event, operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  const permission = action === 'download' ? 'export' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'documents', permission, authorization.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: '缺少文档查看权限' })
  }
  const query: Record<string, string> = {}
  let skipContent = false
  const parameters = getRequestURL(event).searchParams
  for (const [key, value] of Object.entries(getQuery(event))) {
    if (typeof value !== 'string' || parameters.getAll(key).length !== 1) throw createError({ statusCode: 400, message: '文档筛选参数无效' })
    if (action === 'view' && key === 'skip_content') {
      if (value !== '0' && value !== '1') throw createError({ statusCode: 400, message: '正文读取参数无效' })
      skipContent = value === '1'
      continue
    }
    // Old personal pages submit their own owner. Never forward a selected user
    // as authority; Runtime derives personal ownership from the signed actor.
    if (key === 'owner' || key === 'owner_uid') {
      if (value !== user.uid) throw createError({ statusCode: 403, message: '不能选择其他用户的私人文档' })
      continue
    }
    query[key] = value
  }
  const result = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(['view', 'download'].includes(action) ? { code: getRouterParam(event, 'uuid') || '' } : {}),
    query,
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'personal-documents', action: action === 'download' ? 'export' : 'read', expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  })
  if (action !== 'view') return result
  const { withEnterpriseCodocsDocumentContent } = await import('./enterpriseCodocsDocumentContent')
  return await withEnterpriseCodocsDocumentContent(event, result, getRouterParam(event, 'uuid') || '', skipContent)
}
