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

type TimeEntryReadOperation = 'aims.time-entry-list' | 'aims.time-entry-view'

const listQueryKeys = new Set(['startDate', 'endDate', 'uid'])
const numericID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveID(event: H3Event, name: string, message: string) {
  const value = text(getRouterParam(event, name))
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) throw createError({ statusCode: 400, message })
  return value
}

function listInput(event: H3Event) {
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!listQueryKeys.has(key) || Array.isArray(raw)) {
      throw createError({ statusCode: 400, message: '工时筛选参数无效' })
    }
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '工时筛选参数无效' })
    result[key] = value
  }
  return result
}

async function timeEntryRead(
  event: H3Event,
  operation: TimeEntryReadOperation,
  projectId: string,
  query: Record<string, string>,
  timeEntryId = ''
) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'timesheet', 'view', authorization.actionPolicies?.timesheet)) {
    throw createError({ statusCode: 403, message: '无工时查看权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    projectId,
    ...(timeEntryId ? { timeEntryId } : {}),
    query: { ...query, ...scope },
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'timesheet',
      action: 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  })
}

export async function enterpriseAimsTimeEntryList(event: H3Event) {
  const projectId = positiveID(event, 'id', '项目标识无效')
  return await timeEntryRead(event, 'aims.time-entry-list', projectId, listInput(event))
}

export async function enterpriseAimsTimeEntryView(event: H3Event) {
  const projectId = positiveID(event, 'id', '项目标识无效')
  const timeEntryId = positiveID(event, 'entryId', '工时记录标识无效')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '工时详情不接受筛选参数' })
  return await timeEntryRead(event, 'aims.time-entry-view', projectId, {}, timeEntryId)
}
