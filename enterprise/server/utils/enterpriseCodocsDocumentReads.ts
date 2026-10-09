import { optionalReadPagination } from '@hzy/foundation/shared/utils/optionalReadPagination'
import { createError, getQuery, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

const operations = {
  'check-name': 'codocs.personal-document-check-name',
  'list': 'codocs.personal-document-list',
  'view': 'codocs.personal-document-view',
  'download': 'codocs.personal-document-download',
  'trash': 'codocs.personal-document-trash',
  'folders': 'codocs.personal-folder-list'
} as const

async function readDocument(event: H3Event, action: keyof typeof operations, serverUuid?: string, metadataOnly?: boolean) {
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
  let skipContent = metadataOnly === true
  const parameters = getRequestURL(event).searchParams
  for (const [key, value] of Object.entries(getQuery(event))) {
    if (typeof value !== 'string' || parameters.getAll(key).length !== 1)
      throw createError({ statusCode: 400, message: '文档筛选参数无效' })
    if (action === 'view' && key === 'skip_content') {
      if (value !== '0' && value !== '1')
        throw createError({ statusCode: 400, message: '正文读取参数无效' })
      if (metadataOnly !== undefined)
        throw createError({ statusCode: 400, message: '项目正文读取不接受筛选参数' })
      skipContent = value === '1'
      continue
    }
    // Old personal pages submit their own owner. Never forward a selected user
    // as authority; Runtime derives personal ownership from the signed actor.
    if (key === 'owner' || key === 'owner_uid') {
      if (value !== user.uid)
        throw createError({ statusCode: 403, message: '不能选择其他用户的私人文档' })
      continue
    }
    query[key] = value
  }
  if (action === 'trash' || action === 'list' || action === 'folders') {
    try {
      optionalReadPagination(query)
    } catch {
      throw createError({ statusCode: 400, message: '分页参数无效' })
    }
  }
  if ((action === 'list' || action === 'folders') && 'pageSize' in query && ('limit' in query || 'page_size' in query)) {
    throw createError({ statusCode: 400, message: '分页参数不能与旧 limit 混用' })
  }
  if (action === 'folders' && 'parent_id' in query) {
    if (query.folder_type !== 'private' || (!('page' in query) && !('pageSize' in query))
      || Object.keys(query).some(key => !['folder_type', 'parent_id', 'page', 'pageSize'].includes(key))
      || ('parent_id' in query && query.parent_id !== 'null' && !/^[1-9]\d*$/.test(query.parent_id || ''))
      || ('parent_id' in query && query.parent_id !== 'null' && !Number.isSafeInteger(Number(query.parent_id)))) {
      throw createError({ statusCode: 400, message: '私人目录筛选参数无效' })
    }
  }
  if (action === 'list' && 'folder_id' in query && query.folder_id !== 'null'
    && (!/^[1-9]\d*$/.test(query.folder_id || '') || !Number.isSafeInteger(Number(query.folder_id)))) {
    throw createError({ statusCode: 400, message: '文档目录筛选参数无效' })
  }
  let result
  try {
    result = await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant,
      deployment: user.deployment,
      ...(['view', 'download'].includes(action) ? { code: serverUuid ?? getRouterParam(event, 'uuid') ?? '' } : {}),
      query,
      authorization: {
        actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
        resource: 'personal-documents', action: action === 'download' ? 'export' : 'read', expiresAt: enterpriseRuntimePermitExpiresAt()
      }
    })
  } catch (error) {
    // Browser generic reads only (not internal UUID compositions): a Runtime 403 may
    // be a department document opened without its department link. Resolve it through
    // the department read path; anything unresolved keeps the original 403.
    if (action === 'view' && serverUuid === undefined && metadataOnly === undefined && (error as { statusCode?: number }).statusCode === 403) {
      const { resolveEnterpriseDepartmentDocumentFallback } = await import('./enterpriseCodocsDepartmentDocuments')
      const fallback = await resolveEnterpriseDepartmentDocumentFallback(event, getRouterParam(event, 'uuid') ?? '')
      if (fallback)
        return fallback
    }
    throw error
  }
  if (action !== 'view')
    return result
  const { withEnterpriseCodocsDocumentContent } = await import('./enterpriseCodocsDocumentContent')
  return await withEnterpriseCodocsDocumentContent(event, result, serverUuid ?? getRouterParam(event, 'uuid') ?? '', skipContent)
}

export const enterpriseCodocsDocumentRead = (event: H3Event, action: keyof typeof operations) => readDocument(event, action)

// Internal composition only: UUID comes from the project-bound Aims response,
// while the normal Codocs read still independently checks the actor's ACL.
export async function enterpriseCodocsDocumentViewByUuid(event: H3Event, uuid: string, metadataOnly = false) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000')
    throw createError({ statusCode: 503, message: '项目文档正文绑定无效' })
  return await readDocument(event, 'view', uuid, metadataOnly)
}
