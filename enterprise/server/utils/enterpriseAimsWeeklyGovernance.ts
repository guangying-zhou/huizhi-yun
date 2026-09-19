import { createError, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

// 全局周报页：公司周报汇总、周期治理、周报审阅。
// 业务授权按 Aims manifest 的 reports 资源判定；对象级归属仍由 Runtime 执行。

type WeeklyOperation =
  | 'aims.company-weekly-summary-view' | 'aims.company-weekly-summary-versions'
  | 'aims.company-weekly-summary-save-draft' | 'aims.company-weekly-summary-generate'
  | 'aims.company-weekly-summary-publish' | 'aims.company-weekly-summary-cancel-publish'
  | 'aims.company-weekly-summary-open-correction' | 'aims.company-weekly-summary-retry'
  | 'aims.weekly-reporting-period-workbench' | 'aims.weekly-reporting-period-generate'
  | 'aims.weekly-report-review' | 'aims.weekly-report-open-correction'

const permitResource: Record<WeeklyOperation, string> = {
  'aims.company-weekly-summary-view': 'company-weekly-summaries',
  'aims.company-weekly-summary-versions': 'company-weekly-summaries',
  'aims.company-weekly-summary-save-draft': 'company-weekly-summaries',
  'aims.company-weekly-summary-generate': 'company-weekly-summaries',
  'aims.company-weekly-summary-publish': 'company-weekly-summaries',
  'aims.company-weekly-summary-cancel-publish': 'company-weekly-summaries',
  'aims.company-weekly-summary-open-correction': 'company-weekly-summaries',
  'aims.company-weekly-summary-retry': 'company-weekly-summaries',
  'aims.weekly-reporting-period-workbench': 'weekly-reporting-periods',
  'aims.weekly-reporting-period-generate': 'weekly-reporting-periods',
  'aims.weekly-report-review': 'weekly-report-review',
  'aims.weekly-report-open-correction': 'weekly-report-review'
}
const readOperations = new Set<WeeklyOperation>([
  'aims.company-weekly-summary-view', 'aims.company-weekly-summary-versions',
  'aims.weekly-reporting-period-workbench'
])

const periodPattern = /^\d{4}-W\d{2}$/
const numericID = /^[1-9]\d*$/
const workbenchKeys = new Set(['page', 'pageSize', 'deptCode', 'status'])

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
function requirePeriod(event: H3Event) {
  const raw = text(getRouterParam(event, 'periodKey'))
  const code = raw.replace(/:[a-z-]+$/, '')
  if (!periodPattern.test(code)) throw createError({ statusCode: 400, message: '周期标识无效' })
  return code
}
function requireReportID(event: H3Event) {
  const raw = text(getRouterParam(event, 'reportId'))
  const id = raw.replace(/:[a-z-]+$/, '')
  if (!numericID.test(id) || !Number.isSafeInteger(Number(id))) {
    throw createError({ statusCode: 400, message: '周报标识无效' })
  }
  return id
}
async function payloadOf(event: H3Event) {
  const body = await readBody(event).catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

interface WeeklyCall {
  code?: string
  objectId?: string
  query?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function weeklyCall<T>(event: H3Event, operation: WeeklyOperation, call: WeeklyCall = {}): Promise<T> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const write = !readOperations.has(operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const action = write ? 'edit' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'reports', action, authorization.actionPolicies?.reports)) {
    throw createError({ statusCode: 403, message: write ? '无周报编辑权限' : '无周报查看权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.code ? { code: call.code } : {}),
    ...(call.objectId ? { objectId: call.objectId } : {}),
    query: { ...(call.query || {}), ...scope },
    ...(call.payload ? { payload: call.payload } : {}),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: permitResource[operation],
      action: write ? 'edit' : 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {})
}

// 冒号动作在 Nitro 里属于同一路径段，所以 :generate / :publish / :retry 等
// 都进同一个 POST 路由。必须按后缀分发，写死成某一个动作会让其余全部走错。
const summaryPostActions: Record<string, WeeklyOperation> = {
  'generate': 'aims.company-weekly-summary-generate',
  'publish': 'aims.company-weekly-summary-publish',
  'cancel-publish': 'aims.company-weekly-summary-cancel-publish',
  'open-correction': 'aims.company-weekly-summary-open-correction',
  'retry': 'aims.company-weekly-summary-retry'
}
const reportPostActions: Record<string, WeeklyOperation> = {
  'review': 'aims.weekly-report-review',
  'open-correction': 'aims.weekly-report-open-correction'
}

function actionSuffix(raw: string) {
  const m = raw.match(/:([a-z-]+)$/)
  return m?.[1] ?? ''
}

const summaryAction = (operation: WeeklyOperation, withPayload = true) => async (event: H3Event) => {
  const code = requirePeriod(event)
  return await weeklyCall(event, operation, {
    code,
    ...(withPayload ? { payload: await payloadOf(event) } : {}),
    ...(readOperations.has(operation) ? {} : { idempotencyKey: `${operation}:${code}` })
  })
}

export const enterpriseAimsCompanyWeeklySummary = summaryAction('aims.company-weekly-summary-view', false)
export const enterpriseAimsCompanyWeeklySummaryVersions = summaryAction('aims.company-weekly-summary-versions', false)
export const enterpriseAimsCompanyWeeklySummarySaveDraft = summaryAction('aims.company-weekly-summary-save-draft')
export async function enterpriseAimsCompanyWeeklySummaryCommand(event: H3Event) {
  const raw = text(getRouterParam(event, 'periodKey'))
  const operation = summaryPostActions[actionSuffix(raw)]
  if (!operation) throw createError({ statusCode: 404, message: '未知的公司周报动作' })
  const code = requirePeriod(event)
  return await weeklyCall(event, operation, {
    code, payload: await payloadOf(event), idempotencyKey: `${operation}:${code}`
  })
}

export async function enterpriseAimsWeeklyPeriodWorkbench(event: H3Event) {
  const code = requirePeriod(event)
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!workbenchKeys.has(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: '周期筛选参数无效' })
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '周期筛选参数无效' })
    query[key] = value
  }
  return await weeklyCall(event, 'aims.weekly-reporting-period-workbench', { code, query })
}

export async function enterpriseAimsWeeklyPeriodGenerate(event: H3Event) {
  const code = requirePeriod(event)
  return await weeklyCall(event, 'aims.weekly-reporting-period-generate', {
    code, payload: await payloadOf(event), idempotencyKey: `weekly-period-generate:${code}`
  })
}

export async function enterpriseAimsWeeklyReportCommand(event: H3Event) {
  const raw = text(getRouterParam(event, 'reportId'))
  const operation = reportPostActions[actionSuffix(raw)]
  if (!operation) throw createError({ statusCode: 404, message: '未知的周报动作' })
  const objectId = requireReportID(event)
  return await weeklyCall(event, operation, {
    objectId, payload: await payloadOf(event), idempotencyKey: `${operation}:${objectId}`
  })
}

// 项目周报：按周期保存草稿与提交。

async function projectWeeklyReportCall(event: H3Event, operation: 'aims.project-weekly-report-save-draft' | 'aims.project-weekly-report-submit', projectId: string, code: string) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'reports', 'edit', authorization.actionPolicies?.reports)) {
    throw createError({ statusCode: 403, message: '无周报编辑权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    projectId,
    code,
    query: scope,
    payload: await payloadOf(event),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'project-weekly-report-period',
      action: 'edit',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, { idempotencyKey: `${operation}:${projectId}:${code}` })
}

function requireProjectId(event: H3Event) {
  const value = text(getRouterParam(event, 'id'))
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) {
    throw createError({ statusCode: 400, message: '项目标识无效' })
  }
  return value
}

export async function enterpriseAimsProjectWeeklyReportDraft(event: H3Event) {
  const projectId = requireProjectId(event)
  const code = requirePeriod(event)
  return await projectWeeklyReportCall(event, 'aims.project-weekly-report-save-draft', projectId, code)
}

export async function enterpriseAimsProjectWeeklyReportSubmit(event: H3Event) {
  const projectId = requireProjectId(event)
  const code = requirePeriod(event)
  return await projectWeeklyReportCall(event, 'aims.project-weekly-report-submit', projectId, code)
}
