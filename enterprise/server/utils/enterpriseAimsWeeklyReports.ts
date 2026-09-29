import { optionalReadPagination } from '@hzy/foundation/shared/utils/optionalReadPagination'
import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

type WeeklyReportReadOperation = 'aims.weekly-report-list' | 'aims.weekly-report-view'
const numericID = /^[1-9]\d*$/
const periodKeyPattern = /^[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3])$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parameter(event: H3Event, name: string, pattern: RegExp, message: string) {
  const value = text(getRouterParam(event, name))
  if (!pattern.test(value)) throw createError({ statusCode: 400, message })
  return value
}

function projectID(event: H3Event) {
  const value = parameter(event, 'id', numericID, '项目标识无效')
  if (!Number.isSafeInteger(Number(value))) throw createError({ statusCode: 400, message: '项目标识无效' })
  return value
}

function listInput(event: H3Event) {
  const rawQuery = getQuery(event)
  let result: Record<string, string>
  try {
    result = optionalReadPagination(rawQuery)
  } catch {
    throw createError({ statusCode: 400, message: '周报分页参数无效' })
  }
  for (const [key, raw] of Object.entries(rawQuery)) {
    // includeWorkItems 由全局周报页始终携带（loadReports），Aims 侧按 '1' 判定
    if (['page', 'pageSize'].includes(key)) continue
    if (!['year', 'week', 'includeWorkItems'].includes(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: '周报筛选参数无效' })
    const value = text(raw)
    const valid = key === 'year'
      ? /^[0-9]{4}$/.test(value)
      : key === 'week'
        ? /^(?:[1-9]|[1-4][0-9]|5[0-3])$/.test(value)
        : /^[01]$/.test(value)
    if (!valid) throw createError({ statusCode: 400, message: '周报筛选参数无效' })
    result[key] = value
  }
  return result
}

async function weeklyReportRead(
  event: H3Event,
  operation: WeeklyReportReadOperation,
  id: string,
  query: Record<string, string>,
  periodKey = ''
) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'weekly_reports', 'view', authorization.actionPolicies?.weekly_reports)) {
    throw createError({ statusCode: 403, message: '无项目周报查看权限' })
  }
  const canSubmit = authorizationResourcesAllow(authorization.resources, 'weekly_reports', 'submit', authorization.actionPolicies?.weekly_reports)
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    projectId: id,
    ...(periodKey ? { periodKey } : {}),
    ...(periodKey && canSubmit
      ? { weeklyReportSubmitAuthorization: {
          actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
          resource: 'weekly_reports', action: 'submit', projectId: id,
          expiresAt: enterpriseRuntimePermitExpiresAt()
        } }
      : {}),
    query: { ...query, ...scope },
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'weekly_reports',
      action: 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  })
}

export async function enterpriseAimsWeeklyReportList(event: H3Event) {
  return await weeklyReportRead(event, 'aims.weekly-report-list', projectID(event), listInput(event))
}

export async function enterpriseAimsWeeklyReportView(event: H3Event) {
  const id = projectID(event)
  const periodKey = parameter(event, 'periodKey', periodKeyPattern, '周报周期无效')
  const rawQuery = getQuery(event)
  let query: Record<string, string>
  try {
    query = optionalReadPagination(rawQuery)
  } catch {
    throw createError({ statusCode: 400, message: '周报分页参数无效' })
  }
  for (const [key, value] of Object.entries(rawQuery)) {
    if (['page', 'pageSize'].includes(key)) continue
    if (key !== 'includeBaseline' || value !== '1' || !Object.keys(query).length) throw createError({ statusCode: 400, message: '周报详情筛选参数无效' })
    query[key] = '1'
  }
  return await weeklyReportRead(event, 'aims.weekly-report-view', id, query, periodKey)
}
