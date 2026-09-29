import { createError, getQuery, getRequestURL, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { companyAssetPath } from './enterpriseCodocsCompanyAssets'

type AccessRecord = { id: string, viewerUid: string, viewerName?: string, ossPath: string, viewedAt: string }
type AccessPage = { items: AccessRecord[], total: number, page: number, pageSize: number }

function date(value: string | undefined) {
  if (value === undefined || value === '') return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, message: '日期格式应为 YYYY-MM-DD' })
  }
  return value
}

function pageNumber(value: string | undefined, fallback: number, limit: number) {
  if (value === undefined) return fallback
  if (!/^[1-9]\d*$/.test(value) || Number(value) > limit) throw createError({ statusCode: 400, message: '分页参数无效' })
  return Number(value)
}

function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

async function viewerNames(event: H3Event, items: AccessRecord[]) {
  const uids = [...new Set(items.map(item => item.viewerUid).filter(Boolean))]
  const names = new Map<string, string>()
  try {
    for (let i = 0; i < uids.length; i += 100) {
      const response = await fetchConsoleDirectoryApi<{ code: number, data: Array<{ uid: string, realName?: string | null }> }>('/users', { event, params: { uids: uids.slice(i, i + 100).join(',') } })
      if (response.code !== 0 || !Array.isArray(response.data)) throw new Error('Invalid directory response')
      for (const row of response.data) if (row.realName?.trim()) names.set(row.uid, row.realName.trim())
    }
  } catch { throw createError({ statusCode: 503, message: '查看人姓名暂时无法加载' }) }
  for (const item of items) item.viewerName = names.get(item.viewerUid) || '未匹配姓名'
}

export async function enterpriseCompanyAccessRecords(event: H3Event, exportCsv = false) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'admin', 'admin', snapshot.actionPolicies?.admin)
    || !authorizationResourcesAllow(snapshot.resources, 'company', 'admin', snapshot.actionPolicies?.company)
    || (exportCsv && !authorizationResourcesAllow(snapshot.resources, 'company', 'export', snapshot.actionPolicies?.company))) {
    throw createError({ statusCode: 403, message: '缺少查看记录操作权限' })
  }
  const query = getQuery(event)
  const params = getRequestURL(event).searchParams
  const allowed = exportCsv ? ['path', 'from', 'to'] : ['path', 'from', 'to', 'page', 'pageSize']
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string' || params.getAll(key).length !== 1) throw createError({ statusCode: 400, message: '查看记录查询无效' })
  }
  const path = companyAssetPath(String(query.path || ''))
  const from = date(query.from as string | undefined)
  const to = date(query.to as string | undefined)
  if (from && to && from > to) throw createError({ statusCode: 400, message: '开始日期不能晚于结束日期' })
  const page = exportCsv ? 1 : pageNumber(query.page as string | undefined, 1, 1_000_000)
  const pageSize = exportCsv ? 20 : pageNumber(query.pageSize as string | undefined, 20, 100)
  const operation = exportCsv ? 'codocs.company-asset-export-access-records' : 'codocs.company-asset-access-records'
  await prepareEnterpriseRuntime(event, operation)
  const response = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment,
    query: { path, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(!exportCsv ? { page: String(page), pageSize: String(pageSize) } : {}) },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'company-assets', action: exportCsv ? 'export' : 'admin', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }) as { success?: boolean, data?: AccessPage }
  const data = response?.data
  if (response?.success !== true || !data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.page) || !Number.isSafeInteger(data.pageSize)) throw createError({ statusCode: 503, message: '查看记录响应无效' })
  if (!exportCsv) {
    await viewerNames(event, data.items)
    return { code: 0, data }
  }
  await viewerNames(event, data.items)
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="company-asset-access-records.csv"')
  const rows = [['姓名', '用户 UID', '查看时间（UTC）', '文档路径'], ...data.items.map(item => [item.viewerName || '未匹配姓名', item.viewerUid, item.viewedAt, item.ossPath])]
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
