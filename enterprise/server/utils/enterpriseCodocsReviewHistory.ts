import { createError, getQuery, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

export async function enterpriseCodocsReviewByDocument(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const uuid = String(getRouterParam(event, 'uuid') || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(uuid) || getRequestURL(event).search) throw createError({ statusCode: 400, message: '文档标识无效' })
  return reviewHistory(event, 'by-document', uuid)
}

export async function enterpriseCodocsReviewByOssPath(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const raw = getQuery(event)
  const params = getRequestURL(event).searchParams
  if (Object.keys(raw).length !== 1 || typeof raw.path !== 'string' || params.getAll('path').length !== 1) throw createError({ statusCode: 400, message: '发文路径参数无效' })
  const path = raw.path.trim()
  if (!path || [...path].length > 1024 || /[\u0000\r\n]/.test(path) || path.startsWith('/')) throw createError({ statusCode: 400, message: '发文路径参数无效' })
  return reviewHistory(event, path.startsWith('codocs/company/') ? 'company-by-oss-path' : 'by-oss-path', undefined, path)
}

async function reviewHistory(event: H3Event, action: 'by-document' | 'by-oss-path' | 'company-by-oss-path', code?: string, path?: string) {
  const user = await requireEnterpriseUser(event)
  const operation = `codocs.review-history-${action}` as const
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'reviews', 'view', snapshot.actionPolicies?.reviews)) throw createError({ statusCode: 403, message: '缺少发文记录查看权限' })
  if (action === 'company-by-oss-path' && !authorizationResourcesAllow(snapshot.resources, 'admin', 'admin', snapshot.actionPolicies?.admin)) throw createError({ statusCode: 403, message: '仅系统管理员可查看组织资产发布记录' })
  const response = await callEnterpriseRuntime<{ success?: boolean, data?: unknown }>(event, operation, {
    tenant: user.tenant, deployment: user.deployment, ...(code ? { code } : {}), ...(path ? { query: { path } } : {}),
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'review-history', action: action === 'company-by-oss-path' ? 'company-read' : 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
  if (response?.success !== true || !('data' in response)) throw createError({ statusCode: 503, message: '发文记录响应无效' })
  return { code: 0, message: 'success', data: response.data }
}
