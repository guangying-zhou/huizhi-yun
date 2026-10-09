import { randomUUID } from 'node:crypto'
import { createError, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { markdownToDocx } from '../../../codocs/server/utils/markdownToDocx'

const subdirs = new Set(['records', 'outsides', 'rules'])
const departmentCode = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
type DepartmentAction = 'view' | 'export' | 'admin'
type AssetEntry = { name: string, path: string, isDirectory: boolean, size?: number, lastModified?: string }
type Identity = { uid: string, tenant: string, deployment: string }

function query(event: H3Event, allowed: string[]) {
  const raw = getQuery(event)
  const params = getRequestURL(event).searchParams
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key) || typeof value !== 'string' || params.getAll(key).length !== 1)
      throw createError({ statusCode: 400, message: '部门资产查询参数无效' })
    result[key] = value
  }
  return result
}
function segments(value: string, optional = false) {
  if (!value && optional)
    return []
  if (!value || value.length > 800 || value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    throw createError({ statusCode: 400, message: '部门资产路径无效' })
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..'))
    throw createError({ statusCode: 400, message: '部门资产路径无效' })
  return parts
}
export function departmentAssetPrefix(deptCode: string, subdir: string, relative = '') {
  if (!departmentCode.test(deptCode) || !subdirs.has(subdir))
    throw createError({ statusCode: 400, message: '部门资产类别无效' })
  const parts = segments(relative, true)
  return `codocs/departments/${deptCode}/${subdir}/${parts.length ? `${parts.join('/')}/` : ''}`
}
export function departmentAssetPath(path: string, expectedDept?: string) {
  const parts = segments(path)
  if (parts.length < 5 || parts[0] !== 'codocs' || parts[1] !== 'departments' || !departmentCode.test(parts[2] || '') || !subdirs.has(parts[3] || '') || (expectedDept !== undefined && parts[2] !== expectedDept))
    throw createError({ statusCode: 400, message: '部门资产路径无效或部门不一致' })
  return { path: parts.join('/'), deptCode: parts[2]!, subdir: parts[3]! }
}
function integer(raw: string | undefined, fallback: number, max: number) {
  if (raw === undefined)
    return fallback
  if (!/^[1-9]\d*$/.test(raw))
    throw createError({ statusCode: 400, message: '分页参数无效' })
  const number = Number(raw)
  if (!Number.isSafeInteger(number) || number > max)
    throw createError({ statusCode: 400, message: '分页参数无效' })
  return number
}
async function person(event: H3Event, action: DepartmentAction): Promise<Identity> {
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'departments', action, snapshot.actionPolicies?.departments))
    throw createError({ statusCode: 403, message: '缺少部门资产操作权限' })
  return user
}
async function departmentRole(event: H3Event, user: Identity, deptCode: string) {
  if (!departmentCode.test(deptCode))
    throw createError({ statusCode: 400, message: '部门编码无效' })
  const operation = 'codocs.department-access-resolve' as const
  await prepareEnterpriseRuntime(event, operation)
  let response: { success?: boolean, data?: { role?: string, canRead?: boolean } }
  try {
    response = await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, code: deptCode,
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'department-access', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }) as typeof response
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 403)
      throw error
    if (status === 404)
      throw createError({ statusCode: 403, message: '不属于该部门可读范围', data: { code: 'department_relation_none' } })
    throw createError({ statusCode: 503, message: '部门目录暂不可用' })
  }
  if (response?.success !== true || !response.data || typeof response.data.canRead !== 'boolean')
    throw createError({ statusCode: 503, message: '部门目录响应无效' })
  if (!response.data.canRead || response.data.role === 'none')
    throw createError({ statusCode: 403, message: '不属于该部门可读范围', data: { code: 'department_relation_none' } })
}
export async function requireDepartmentAsset(event: H3Event, deptCode: string, action: DepartmentAction) {
  const user = await person(event, action)
  await departmentRole(event, user, deptCode)
  return user
}
export async function listDepartmentAssetDepartments(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (getRequestURL(event).search)
    throw createError({ statusCode: 400, message: '部门列表参数无效' })
  const user = await person(event, 'view')
  const operation = 'console.directory-self-accessible-departments' as const
  await prepareEnterpriseRuntime(event, operation)
  let rows: Array<{ deptCode: string, name: string }>
  try {
    const response = await callEnterpriseRuntime(event, operation, {}) as { data?: unknown }
    if (!Array.isArray(response.data))
      throw new Error('invalid directory response')
    rows = response.data as typeof rows
  } catch {
    throw createError({ statusCode: 503, message: '部门目录暂不可用' })
  }
  const departments = []
  for (const row of rows) {
    if (!row || !departmentCode.test(row.deptCode) || typeof row.name !== 'string')
      throw createError({ statusCode: 503, message: '部门目录响应无效' })
    try {
      await departmentRole(event, user, row.deptCode)
      departments.push(row)
    } catch (error) {
      if ((error as { data?: { code?: string } }).data?.code !== 'department_relation_none')
        throw error
    }
  }
  return { code: 0, data: { departments, primaryDeptCode: departments[0]?.deptCode || null } }
}
export async function listEnterpriseDepartmentAssets(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const q = query(event, ['deptCode', 'subdir', 'path', 'page', 'pageSize'])
  const prefix = departmentAssetPrefix(q.deptCode || '', q.subdir || '', q.path || '')
  await requireDepartmentAsset(event, q.deptCode!, 'view')
  const page = integer(q.page, 1, 1_000_000), pageSize = integer(q.pageSize, 20, 100)
  const client = await createRuntimeOSSClient({ event })
  const entries: AssetEntry[] = []
  let token: string | undefined
  let requests = 0
  do {
    const result = await client.listV2({ prefix, 'delimiter': '/', 'continuation-token': token, 'max-keys': 500 })
    for (const path of result.prefixes || []) {
      if (!path.startsWith(prefix) || !path.endsWith('/'))
        throw createError({ statusCode: 503, message: '部门资产存储响应无效' })
      const name = path.slice(prefix.length, -1)
      if (name && !name.includes('/'))
        entries.push({ name, path, isDirectory: true })
    }
    for (const item of result.objects || []) {
      if (!item.name.startsWith(prefix))
        throw createError({ statusCode: 503, message: '部门资产存储响应无效' })
      const name = item.name.slice(prefix.length)
      if (name && !name.includes('/') && !name.endsWith('/'))
        entries.push({ name, path: item.name, isDirectory: false, size: item.size, lastModified: item.lastModified })
    }
    token = result.isTruncated ? result.nextContinuationToken : undefined
    if ((result.isTruncated && !token) || ++requests > 10_000)
      throw createError({ statusCode: 503, message: '部门资产列表暂不可用' })
  } while (token)
  entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || (b.lastModified || '').localeCompare(a.lastModified || '') || a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const offset = (page - 1) * pageSize
  return { code: 0, data: { items: entries.slice(offset, offset + pageSize), total: entries.length, page, pageSize } }
}
async function recordAccess(event: H3Event, user: Identity, path: string) {
  const operation = 'codocs.company-asset-record-access' as const
  await prepareEnterpriseRuntime(event, operation)
  const eventId = randomUUID()
  try {
    const response = await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, payload: { path, eventId },
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'company-assets', action: 'record-access', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }, { idempotencyKey: `codocs:department-access:${eventId}` }) as { success?: boolean, data?: { recorded?: boolean, id?: string } }
    if (response?.success !== true || response.data?.recorded !== true || response.data.id !== eventId)
      throw new Error('invalid receipt')
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 403)
      throw error
    throw createError({ statusCode: 503, message: '查看记录暂时无法保存' })
  }
}
export async function previewEnterpriseDepartmentAsset(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const q = query(event, ['path', 'deptCode', 'format'])
  const asset = departmentAssetPath(q.path || '', q.deptCode)
  const user = await requireDepartmentAsset(event, asset.deptCode, 'view')
  const ext = asset.path.split('.').at(-1)?.toLowerCase() || ''
  if (q.format && (q.format !== 'pdf' || ext !== 'pdf'))
    throw createError({ statusCode: 400, message: '预览格式无效' })
  const client = await createRuntimeOSSClient({ event })
  if (ext === 'pdf' && !q.format) {
    try {
      await client.head(asset.path)
    } catch {
      throw createError({ statusCode: 404, message: '文件不存在' })
    }
    return { code: 0, data: { preview_url: `/codocs/api/dept-assets/preview?format=pdf&path=${encodeURIComponent(asset.path)}`, file_ext: 'pdf' } }
  }
  let content: Buffer
  try {
    content = (await client.get(asset.path)).content
  } catch {
    throw createError({ statusCode: 503, message: '部门资产存储暂不可用' })
  }
  await recordAccess(event, user, asset.path)
  if (ext === 'pdf') {
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return content
  }
  if (!['md', 'markdown', 'txt'].includes(ext))
    throw createError({ statusCode: 415, message: '不支持预览此文件' })
  return { code: 0, data: { content: content.toString('utf8'), file_ext: ext } }
}
function extra(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
export async function exportEnterpriseDepartmentAssetDocx(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !['path', 'filename', 'deptCode'].includes(key)) || typeof body.path !== 'string')
    throw createError({ statusCode: 400, message: '导出请求无效' })
  if (body.deptCode !== undefined && typeof body.deptCode !== 'string')
    throw createError({ statusCode: 400, message: '部门编码无效' })
  const asset = departmentAssetPath(body.path, body.deptCode as string | undefined)
  if (asset.subdir !== 'outsides')
    throw createError({ statusCode: 400, message: '仅对外发文支持 DOCX 导出' })
  const review = await outsideReview(event, asset)
  if (!review)
    throw createError({ statusCode: 403, message: '未找到发布记录，暂不允许导出 DOCX' })
  if (String(extra(review.extra)?.outsideFileLevel || 'general') !== 'general')
    throw createError({ statusCode: 403, message: '重要文件和关键文件仅支持导出 PDF' })
  const client = await createRuntimeOSSClient({ event })
  let content: Buffer
  try {
    content = (await client.get(asset.path)).content
  } catch {
    throw createError({ statusCode: 503, message: '部门资产存储暂不可用' })
  }
  const base = (typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim() : asset.path.split('/').at(-1) || 'document').replace(/\.md$/i, '')
  if (!base || base.length > 180 || Array.from(base).some(char => char === '\u0000' || char === '\n' || char === '\r' || char === '/' || char === '\\'))
    throw createError({ statusCode: 400, message: '导出文件名无效' })
  const output = await markdownToDocx(content.toString('utf8'), base)
  const encoded = encodeURIComponent(`${base}.docx`)
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  setHeader(event, 'Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`)
  return output
}
async function outsideReview(event: H3Event, asset: ReturnType<typeof departmentAssetPath>) {
  const user = await requireDepartmentAsset(event, asset.deptCode, 'export')
  const operation = 'codocs.review-history-by-oss-path' as const
  await prepareEnterpriseRuntime(event, operation)
  const response = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, query: { path: asset.path },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'review-history', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }) as { success?: boolean, data?: { extra?: unknown } | null }
  if (response?.success !== true)
    throw createError({ statusCode: 503, message: '发布记录暂不可用' })
  return response.data || null
}
export async function enterpriseDepartmentAssetExportPolicy(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const q = query(event, ['path'])
  const asset = departmentAssetPath(q.path || '')
  if (asset.subdir !== 'outsides')
    throw createError({ statusCode: 400, message: '仅对外发文支持 DOCX 导出' })
  const review = await outsideReview(event, asset)
  return { code: 0, data: review ? { extra: { outsideFileLevel: extra(review.extra)?.outsideFileLevel || 'general' } } : null }
}
