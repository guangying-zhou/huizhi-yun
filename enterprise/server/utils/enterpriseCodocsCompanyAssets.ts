import { randomUUID } from 'node:crypto'
import { createError, getQuery, getRequestURL, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'

const subdirs = new Set(['rules', 'notices', 'legal', 'culture', 'tech-specs', 'knowledge', 'templates'])
type AssetEntry = { name: string, path: string, isDirectory: boolean, size?: number, lastModified?: string }

function singleQuery(event: H3Event, allowed: readonly string[]) {
  const url = getRequestURL(event)
  const query = getQuery(event)
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string' || url.searchParams.getAll(key).length !== 1) {
      throw createError({ statusCode: 400, message: '组织资产查询参数无效' })
    }
    result[key] = value
  }
  return result
}

function checkedSegments(value: string, allowEmpty = false) {
  if (!value && allowEmpty) return []
  if (!value || value.length > 800 || value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw createError({ statusCode: 400, message: '组织资产路径无效' })
  const segments = value.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw createError({ statusCode: 400, message: '组织资产路径无效' })
  return segments
}

export function companyAssetPrefix(subdir: string, relative = '') {
  if (!subdirs.has(subdir)) throw createError({ statusCode: 400, message: '组织资产类别无效' })
  const segments = checkedSegments(relative, true)
  return `codocs/company/${subdir}/${segments.length ? `${segments.join('/')}/` : ''}`
}

export function companyAssetPath(path: string) {
  const segments = checkedSegments(path)
  if (segments.length < 4 || segments[0] !== 'codocs' || segments[1] !== 'company' || !subdirs.has(segments[2] || '')) {
    throw createError({ statusCode: 400, message: '组织资产路径无效' })
  }
  return segments.join('/')
}

async function requireCompanyPermission(event: H3Event, action: 'view' | 'admin' | 'publish' | 'export', requireAdmin = false) {
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'company', action, snapshot.actionPolicies?.company)
    || (requireAdmin && !authorizationResourcesAllow(snapshot.resources, 'admin', 'admin', snapshot.actionPolicies?.admin))) {
    throw createError({ statusCode: 403, message: '缺少组织资产操作权限' })
  }
  return user
}

function pageValue(raw: string | undefined, fallback: number, max: number) {
  if (raw === undefined) return fallback
  if (!/^[1-9]\d*$/.test(raw)) throw createError({ statusCode: 400, message: '分页参数无效' })
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > max) throw createError({ statusCode: 400, message: '分页参数无效' })
  return value
}

export async function listEnterpriseCompanyAssets(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  await requireCompanyPermission(event, 'view')
  const query = singleQuery(event, ['subdir', 'path', 'page', 'pageSize'])
  const prefix = companyAssetPrefix(query.subdir || '', query.path || '')
  const page = pageValue(query.page, 1, 1_000_000)
  const pageSize = pageValue(query.pageSize, 20, 100)
  const client = await createRuntimeOSSClient({ event })
  const entries: AssetEntry[] = []
  let token: string | undefined
  let requests = 0
  do {
    const listing = await client.listV2({ prefix, 'delimiter': '/', 'continuation-token': token, 'max-keys': 500 })
    for (const path of listing.prefixes || []) {
      if (!path.startsWith(prefix) || !path.endsWith('/')) throw createError({ statusCode: 503, message: '组织资产存储响应无效' })
      const name = path.slice(prefix.length, -1)
      if (name && !name.includes('/')) entries.push({ name, path, isDirectory: true })
    }
    for (const item of listing.objects || []) {
      if (!item.name.startsWith(prefix)) throw createError({ statusCode: 503, message: '组织资产存储响应无效' })
      const name = item.name.slice(prefix.length)
      if (name && !name.includes('/') && !name.endsWith('/')) entries.push({ name, path: item.name, isDirectory: false, size: item.size, lastModified: item.lastModified })
    }
    token = listing.isTruncated ? listing.nextContinuationToken : undefined
    if ((listing.isTruncated && !token) || ++requests > 10_000) throw createError({ statusCode: 503, message: '组织资产列表暂不可用' })
  } while (token)
  entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || (b.lastModified || '').localeCompare(a.lastModified || '') || a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const offset = (page - 1) * pageSize
  return { code: 0, data: { items: entries.slice(offset, offset + pageSize), total: entries.length, page, pageSize } }
}

async function recordCompanyAccess(event: H3Event, path: string) {
  const user = await requireCompanyPermission(event, 'view')
  const operation = 'codocs.company-asset-record-access' as const
  await prepareEnterpriseRuntime(event, operation)
  const eventId = randomUUID()
  let result: { success?: boolean, data?: { recorded?: boolean, id?: string } }
  try {
    result = await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment,
      payload: { path, eventId },
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'company-assets', action: 'record-access', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }, { idempotencyKey: `codocs:company-access:${eventId}` }) as typeof result
  } catch (error) {
    const status = (error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status
    if (status === 401 || status === 403) throw error
    throw createError({ statusCode: 503, message: '查看记录暂时无法保存' })
  }
  if (result?.success !== true || result.data?.recorded !== true || result.data.id !== eventId) {
    throw createError({ statusCode: 503, message: '查看记录暂时无法保存' })
  }
}

export async function previewEnterpriseCompanyAsset(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  await requireCompanyPermission(event, 'view')
  const query = singleQuery(event, ['path', 'format'])
  const path = companyAssetPath(query.path || '')
  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (query.format && (query.format !== 'pdf' || ext !== 'pdf')) throw createError({ statusCode: 400, message: '预览格式无效' })
  const client = await createRuntimeOSSClient({ event })
  if (ext === 'pdf' && !query.format) {
    try {
      await client.head(path)
    } catch {
      throw createError({ statusCode: 404, message: '文件不存在' })
    }
    return { code: 0, data: { preview_url: `/codocs/api/company-assets/preview?format=pdf&path=${encodeURIComponent(path)}`, file_ext: 'pdf' } }
  }
  let content: Buffer
  try {
    content = (await client.get(path)).content
  } catch {
    throw createError({ statusCode: 503, message: '组织资产存储暂不可用' })
  }
  // No bytes or text leave this handler until the record has committed.
  await recordCompanyAccess(event, path)
  if (ext === 'pdf') {
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return content
  }
  if (!['md', 'markdown', 'txt'].includes(ext)) throw createError({ statusCode: 415, message: '不支持预览此文件' })
  return { code: 0, data: { content: content.toString('utf8'), file_ext: ext } }
}
