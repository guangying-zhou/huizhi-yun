import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createEnterpriseCodocsDocument } from './enterpriseCodocsDocumentCreation'

const yearPattern = /^\d{4}$/
const weeklyTitle = /^(\d{4})-W(\d{2})-.*工作周报$/

async function authorize(event: H3Event, action: 'view' | 'create') {
  const user = await requireEnterpriseUser(event)
  await prepareEnterpriseRuntime(event, action === 'view' ? 'codocs.personal-document-list' : 'codocs.personal-document-create')
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', action, snapshot.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: action === 'view' ? '缺少文档查看权限' : '缺少文档创建权限' })
  }
  return user
}

export async function enterpriseCodocsPersonalWeeklyReportsList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const params = getRequestURL(event).searchParams
  const query = getQuery(event)
  if (params.getAll('year').length !== 1 || typeof query.year !== 'string' || !yearPattern.test(query.year)) {
    throw createError({ statusCode: 400, message: '年份参数无效' })
  }
  const user = await authorize(event, 'view')
  // Legacy weekly reports are private documents. Query both kinds narrowly;
  // owner is still derived only from the signed actor at Runtime.
  const rows = new Map<string, Record<string, unknown>>()
  for (const type of ['private', 'weekly-report']) {
    const result = await callEnterpriseRuntime<{ success?: boolean, data?: { items?: Array<Record<string, unknown>> } }>(event, 'codocs.personal-document-list', {
      tenant: user.tenant, deployment: user.deployment,
      query: { type, search: `${query.year}-W`, page: '1', pageSize: '200' },
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
    })
    for (const row of result?.data?.items || []) if (typeof row.uuid === 'string') rows.set(row.uuid, row)
  }
  const items = [...rows.values()].filter(row => typeof row.title === 'string' && weeklyTitle.test(row.title) && row.title.startsWith(`${query.year}-`)).map(row => {
    const match = String(row.title).match(weeklyTitle)
    return { ...row, year: Number(match?.[1] || query.year), week: Number(match?.[2] || 0) }
  }).sort((a, b) => String((b as Record<string, unknown>).title).localeCompare(String((a as Record<string, unknown>).title)))
  return { success: true, data: { items } }
}

export async function enterpriseCodocsPersonalWeeklyReportsCreate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (getRequestURL(event).search) throw createError({ statusCode: 400, message: '创建周报不接受查询参数' })
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '创建周报需要有效的 Idempotency-Key' })
  const user = await authorize(event, 'create')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: '周报参数无效' })
  if ('owner_uid' in body && body.owner_uid !== undefined && body.owner_uid !== user.uid) throw createError({ statusCode: 403, message: '不能为其他用户创建周报' })
  const year = Number(body.year)
  const week = Number(body.week)
  if (!Number.isInteger(year) || !yearPattern.test(String(year)) || !Number.isInteger(week) || week < 1 || week > 53) {
    throw createError({ statusCode: 400, message: '周报年份或周数无效' })
  }
  const weekText = String(week).padStart(2, '0')
  const title = `${year}-W${weekText}-个人工作周报`
  const content = `# ${title}\n\n## 本周工作\n\n## 下周计划\n\n## 需要协调的事项\n`
  return createEnterpriseCodocsDocument(event, async () => ({ title, doc_type: 'weekly-report', content }), key)
}
