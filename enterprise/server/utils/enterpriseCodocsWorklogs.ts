import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createEnterpriseCodocsDocument } from './enterpriseCodocsDocumentCreation'

const yearPattern = /^\d{4}$/
const monthPattern = /^(?:[1-9]|1[0-2])$/
const worklogTitle = /^(\d{4})(\d{2})(\d{2})-.*工作日志$/

function validDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

async function authorize(event: H3Event, action: 'view' | 'create') {
  const user = await requireEnterpriseUser(event)
  await prepareEnterpriseRuntime(event, action === 'view' ? 'codocs.personal-document-list' : 'codocs.personal-document-create')
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', action, snapshot.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: action === 'view' ? '缺少文档查看权限' : '缺少文档创建权限' })
  }
  return user
}

export async function enterpriseCodocsWorklogsList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const params = getRequestURL(event).searchParams
  const query = getQuery(event)
  if (params.getAll('year').length !== 1 || params.getAll('month').length !== 1
    || typeof query.year !== 'string' || !yearPattern.test(query.year)
    || typeof query.month !== 'string' || !monthPattern.test(query.month)
    || Object.keys(query).some(key => key !== 'year' && key !== 'month')) {
    throw createError({ statusCode: 400, message: '工作日志日期参数无效' })
  }
  const user = await authorize(event, 'view')
  const prefix = `${query.year}${String(query.month).padStart(2, '0')}`
  const rows = new Map<string, Record<string, unknown>>()
  // Legacy worklogs are private documents and used both YYYYMMDD-* and
  // 工作日志_YYYYMMDD titles. New Host writes use the explicit worklog type.
  for (const filter of [
    { type: 'worklog', search: prefix },
    { type: 'private', search: prefix },
    { type: 'private', search: `工作日志_${prefix}` }
  ]) {
    const result = await callEnterpriseRuntime<{ success?: boolean, data?: { items?: Array<Record<string, unknown>> } }>(event, 'codocs.personal-document-list', {
      tenant: user.tenant, deployment: user.deployment,
      query: { ...filter, page: '1', pageSize: '200' },
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
    })
    for (const row of result?.data?.items || []) if (typeof row.uuid === 'string') rows.set(row.uuid, row)
  }
  const items = [...rows.values()].flatMap(row => {
    const match = typeof row.title === 'string' ? row.title.match(worklogTitle) : null
    const legacy = typeof row.title === 'string' ? row.title.match(/^工作日志_(\d{4})(\d{2})(\d{2})$/) : null
    const parts = match || legacy
    const dateKey = parts?.[1] && parts[2] && parts[3] ? `${parts[1]}${parts[2]}${parts[3]}` : ''
    const date = dateKey ? `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}` : ''
    return dateKey && dateKey.slice(0, 6) === prefix && validDateKey(dateKey) ? [{ ...row, date }] : []
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return { success: true, data: { items } }
}

export async function enterpriseCodocsWorklogsCreate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (getRequestURL(event).search) throw createError({ statusCode: 400, message: '创建工作日志不接受查询参数' })
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '创建工作日志需要有效的 Idempotency-Key' })
  const user = await authorize(event, 'create')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(field => field !== 'date') || !validDateKey(body.date)) {
    throw createError({ statusCode: 400, message: '工作日志日期无效' })
  }
  const date = body.date
  const title = `${date}-工作日志`
  const dateText = `${date.slice(0, 4)}年${date.slice(4, 6)}月${date.slice(6, 8)}日`
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)))).getUTCDay()]
  const content = `# ${dateText} 星期${weekday} 工作日志\n\n## 今日工作\n\n## 明日计划\n\n## 遇到的问题/需要协调的事项\n\n`
  return createEnterpriseCodocsDocument(event, async () => ({ title, doc_type: 'worklog', content }), key)
}
