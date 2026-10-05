import { createError, type H3Event } from 'h3'
import { parsePublishedAssetPath, publishedAssetShortPagePath } from '~~/shared/utils/publishedAssetLink'
import { requireRequestUid } from './authIdentity'
import { requirePermission } from './checkPermission'
import { callCodocsTenantRuntime } from './codocsRuntime'
import { createRuntimeOSSClient } from './oss'

interface PublishedAssetLink { token: string, path: string }
const runtimePath = '/v1/codocs/published-asset-links'
const actionKey = 'codocs_trusted_published_asset_link_action'

async function requireAssetRead(event: H3Event, path: unknown) {
  const asset = parsePublishedAssetPath(path)
  if (!asset) throw createError({ statusCode: 400, message: '无效的已发布文档路径' })
  // Published department assets use the same permission as /dept-assets/preview.
  await requirePermission(event, asset.scope, 'view', '缺少已发布文档查看权限')
  return asset
}

export async function createPublishedAssetShortLink(event: H3Event, path: unknown) {
  requireRequestUid(event)
  const asset = await requireAssetRead(event, path)
  const client = await createRuntimeOSSClient({ event })
  try {
    await client.head(asset.path)
  } catch (error) {
    const value = error as { status?: number, statusCode?: number, code?: string }
    if (value.status === 404 || value.statusCode === 404 || value.code === 'NoSuchKey') {
      throw createError({ statusCode: 404, message: '文档不存在或已移动' })
    }
    throw createError({ statusCode: 503, message: '暂时无法验证文档，请稍后重试' })
  }
  const link = await callCodocsTenantRuntime<PublishedAssetLink>(event, runtimePath, {
    method: 'POST',
    query: { path: asset.path, [actionKey]: 'create' }
  })
  if (link.path !== asset.path || !publishedAssetShortPagePath(link.token)) {
    throw createError({ statusCode: 502, message: '文档短链接生成失败' })
  }
  return link
}

export async function resolvePublishedAssetShortLink(event: H3Event, token: unknown) {
  requireRequestUid(event)
  if (!publishedAssetShortPagePath(token)) throw createError({ statusCode: 400, message: '无效的文档短链接' })
  const link = await callCodocsTenantRuntime<PublishedAssetLink>(event, `${runtimePath}/${token}`, {
    query: { [actionKey]: 'resolve' }
  })
  if (link.token !== token) throw createError({ statusCode: 502, message: '文档短链接解析失败' })
  await requireAssetRead(event, link.path)
  return link
}
