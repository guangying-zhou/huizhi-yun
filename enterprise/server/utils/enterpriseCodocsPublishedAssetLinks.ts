import { createHash } from 'node:crypto'
import { createError, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { parsePublishedAssetPath, publishedAssetShortPagePath } from '../../../codocs/shared/utils/publishedAssetLink'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { requireDepartmentAsset } from './enterpriseCodocsDepartmentAssets'

type Link = { token: string, path: string }

async function requirePublishedAssetRead(event: H3Event, path: unknown) {
  const asset = parsePublishedAssetPath(path)
  if (!asset) throw createError({ statusCode: 400, message: '已发布文档路径无效' })
  if (asset.scope === 'departments') {
    const deptCode = asset.path.split('/')[2] || ''
    const user = await requireDepartmentAsset(event, deptCode, 'view')
    return { user, asset }
  }
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'company', 'view', snapshot.actionPolicies?.company)) {
    throw createError({ statusCode: 403, message: '缺少组织资产查看权限' })
  }
  return { user, asset }
}

export async function createEnterprisePublishedAssetLink(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Object.keys(body).some(key => key !== 'path')) throw createError({ statusCode: 400, message: '短链接请求无效' })
  const { user, asset } = await requirePublishedAssetRead(event, body.path)
  const client = await createRuntimeOSSClient({ event })
  try {
    await client.head(asset.path)
  } catch {
    throw createError({ statusCode: 503, message: '暂时无法验证文档' })
  }
  const operation = 'codocs.published-asset-links-create' as const
  await prepareEnterpriseRuntime(event, operation)
  const result = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, payload: { path: asset.path },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'published-asset-links', action: 'create', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: `codocs:asset-link:${createHash('sha256').update(`${user.uid}\n${asset.path}`).digest('hex')}` }) as { success?: boolean, data?: Link }
  if (result?.success !== true || result.data?.path !== asset.path || !publishedAssetShortPagePath(result.data.token)) throw createError({ statusCode: 503, message: '短链接响应无效' })
  return { code: 0, data: result.data }
}

export async function resolveEnterprisePublishedAssetLink(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const token = getRouterParam(event, 'token') || ''
  if (!publishedAssetShortPagePath(token)) throw createError({ statusCode: 400, message: '短链接无效' })
  const user = await requireEnterpriseUser(event)
  const operation = 'codocs.published-asset-links-resolve' as const
  await prepareEnterpriseRuntime(event, operation)
  const result = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: token,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'published-asset-links', action: 'resolve', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }) as { success?: boolean, data?: Link }
  if (result?.success !== true || result.data?.token !== token) throw createError({ statusCode: 503, message: '短链接响应无效' })
  await requirePublishedAssetRead(event, result.data.path)
  return { code: 0, data: result.data }
}
