import { createError, getQuery, setHeader, type H3Event } from 'h3'
import { optionalReadPagination } from '@hzy/foundation/shared/utils/optionalReadPagination'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

export async function enterpriseAimsWeeklyReportOverview(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const rawQuery = getQuery(event)
  let pagination: Record<string, string>
  try {
    pagination = optionalReadPagination(rawQuery)
  } catch {
    throw createError({ statusCode: 400, message: '周报分页参数无效' })
  }
  const query: Record<string, string> = { ...pagination }
  for (const [key, raw] of Object.entries(rawQuery)) {
    if (['page', 'pageSize'].includes(key)) continue
    if (!['year', 'week', 'search', 'deptCode', 'category', 'includeWorkItems'].includes(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: '周报筛选参数无效' })
    const value = String(raw || '').trim()
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '周报筛选参数无效' })
    query[key] = value
  }
  if (!/^\d{4}$/.test(query.year || '') || !/^(?:[1-9]|[1-4]\d|5[0-3])$/.test(query.week || '') || (query.includeWorkItems && query.includeWorkItems !== '1')) throw createError({ statusCode: 400, message: '周报筛选参数无效' })
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'weekly_reports', 'view', authorization.actionPolicies?.weekly_reports)) throw createError({ statusCode: 403, message: '无项目周报查看权限' })
  await prepareEnterpriseRuntime(event, 'aims.weekly-report-overview')
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime(event, 'aims.weekly-report-overview', {
    tenant: user.tenant, deployment: user.deployment, query: { ...query, ...scope },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'weekly_reports', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
}
