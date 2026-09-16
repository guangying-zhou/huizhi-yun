import { createError, type H3Event } from 'h3'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { normalizeCompanyAssetOssPath } from './assetOssPath'
import { requirePermission } from './checkPermission'
import { callCodocsTenantRuntime } from './codocsRuntime'

export interface CompanyAssetAccessRecord {
  id: string
  viewerUid: string
  viewerName?: string
  ossPath: string
  viewedAt: string
}

export interface CompanyAssetAccessRecordPage {
  items: CompanyAssetAccessRecord[]
  total: number
  page: number
  pageSize: number
}

const trustedActionKey = 'codocs_trusted_company_asset_access_action'
const runtimePath = '/v1/codocs/company-assets/access-records'

/** Call only after authorization and successfully preparing the preview response. */
export async function recordCompanyAssetAccess(event: H3Event, path: string) {
  try {
    await callCodocsTenantRuntime(event, runtimePath, {
      method: 'POST',
      query: {
        path: normalizeCompanyAssetOssPath(path),
        eventId: crypto.randomUUID(),
        [trustedActionKey]: 'record'
      }
    })
  } catch {
    // Do not deliver an untracked preview or expose underlying infrastructure errors.
    throw createError({ statusCode: 503, message: '查看记录暂时无法保存，请稍后重试' })
  }
}

function dateFilter(value: unknown) {
  if (value === undefined || value === '') return undefined
  const text = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw createError({ statusCode: 400, message: '日期格式应为 YYYY-MM-DD' })
  }
  return text
}

function pageNumber(value: unknown, fallback: number, maximum: number) {
  if (value === undefined || value === '') return fallback
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw createError({ statusCode: 400, message: '无效的分页参数' })
  }
  return number
}

export async function listCompanyAssetAccessRecords(event: H3Event, source: Record<string, unknown>, exporting = false) {
  await requirePermission(event, 'admin', 'admin', '仅系统管理员可以查看文档查看记录')
  await requirePermission(event, 'company', 'admin', '缺少组织资产管理权限')
  if (exporting) await requirePermission(event, 'company', 'export', '缺少组织资产导出权限')

  const from = dateFilter(source.from)
  const to = dateFilter(source.to)
  if (from && to && from > to) throw createError({ statusCode: 400, message: '开始日期不能晚于结束日期' })
  // Never forward browser actor, scope or trusted marker fields. Foundation
  // delegates the verified session actor and signs this exact query target.
  const result = await callCodocsTenantRuntime<CompanyAssetAccessRecordPage>(event, exporting ? `${runtimePath}/export` : runtimePath, {
    query: {
      path: normalizeCompanyAssetOssPath(source.path),
      from,
      to,
      page: exporting ? 1 : pageNumber(source.page, 1, 1000000),
      pageSize: exporting ? 20 : pageNumber(source.pageSize, 20, 100),
      [trustedActionKey]: exporting ? 'export' : 'list'
    }
  })
  if (exporting) await resolveViewerNames(event, result.items)
  return result
}

async function resolveViewerNames(event: H3Event, items: CompanyAssetAccessRecord[]) {
  const uids = [...new Set(items.map(item => item.viewerUid).filter(Boolean))]
  const names = new Map<string, string>()
  try {
    for (let start = 0; start < uids.length; start += 100) {
      const response = await fetchConsoleDirectoryApi<{
        code: number
        data: Array<{ uid: string, realName?: string | null }>
      }>('/users', { event, params: { uids: uids.slice(start, start + 100).join(',') } })
      if (response.code !== 0 || !Array.isArray(response.data)) throw new Error('Invalid directory response')
      for (const user of response.data) {
        if (user.realName?.trim()) names.set(user.uid, user.realName.trim())
      }
    }
  } catch (error: unknown) {
    const status = (error as { statusCode?: number })?.statusCode
    if (status === 401 || status === 403) throw error
    throw createError({ statusCode: 503, message: '查看人姓名暂时无法加载，请稍后重试导出' })
  }
  for (const item of items) item.viewerName = names.get(item.viewerUid) || '未匹配姓名'
}

function csvCell(value: string) {
  // Excel evaluates formulas even in quoted CSV cells. Prefix dangerous cells
  // (including whitespace-hidden formulas); keep UID/path values otherwise intact.
  const safe = /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function companyAssetAccessRecordsCsv(items: CompanyAssetAccessRecord[]) {
  const rows = [['姓名', '用户 UID', '查看时间（UTC）', '文档路径'], ...items.map(item => [item.viewerName || '未匹配姓名', item.viewerUid, item.viewedAt, item.ossPath])]
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
