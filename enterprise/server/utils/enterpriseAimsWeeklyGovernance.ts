import { createError, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import { requireCurrentProjectGovernanceRoleHolder } from '@hzy/foundation/server/utils/projectGovernanceRoleHolder'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'
import { resolveCompanyWeeklySummaryRecipients } from '../../../aims/server/utils/companyWeeklySummaryRecipients'

// 全局周报页：公司周报汇总、周期治理、周报审阅。
// 业务授权按 Aims manifest 的 reports 资源判定；对象级归属仍由 Runtime 执行。

type WeeklyOperation
  = | 'aims.company-weekly-summary-view' | 'aims.company-weekly-summary-versions'
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

// 项目治理角色标志只能由宿主按已验证会话推导，与独立 Aims BFF 的
// resolveAimsRuntimeQuery 同一集合：调用方自带的同名参数一律丢弃。
const governanceQueryKeySet = new Set([
  'current_user_is_project_director', 'currentUserIsProjectDirector',
  'current_user_project_director_revision', 'currentUserProjectDirectorRevision',
  'current_user_can_configure_weekly_reports', 'currentUserCanConfigureWeeklyReports',
  'current_user_can_submit_weekly_report', 'currentUserCanSubmitWeeklyReport',
  'current_user_can_submit_assigned_weekly_report', 'currentUserCanSubmitAssignedWeeklyReport',
  'current_user_is_qa', 'currentUserIsQa',
  'current_user_qa_revision', 'currentUserQaRevision',
  // 只有宿主在服务端实际展开抄送清单后才写入（见 publishCompanyWeeklySummary）。
  'company_summary_recipient_resolution_verified', 'companySummaryRecipientResolutionVerified'
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
  /** 宿主服务端推导的受信标志，在剥离调用方同名键之后写入。 */
  trustedQuery?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

type AuthorizationSnapshot = Awaited<ReturnType<typeof loadAuthorizationSnapshotFromConsoleRuntime>>

/**
 * 与独立 Aims BFF applyProjectGovernanceRoleContext（及公司周报 publish/retry
 * 路由）逐条对齐：总监身份先看 weekly_reports:review，敏感命令再向 Console
 * 读取唯一 project_director 持有人并带上当期 revision。Runtime 只认这里写入的值。
 */
async function weeklyGovernanceQuery(
  event: H3Event,
  operation: WeeklyOperation,
  uid: string,
  authorization: AuthorizationSnapshot
): Promise<Record<string, string>> {
  const allows = (action: string) => authorizationResourcesAllow(
    authorization.resources, 'weekly_reports', action, authorization.actionPolicies?.weekly_reports
  )
  const isProjectDirector = allows('review')
  const canConfigure = allows('configure')
  const query: Record<string, string> = {
    current_user_is_project_director: isProjectDirector ? '1' : '0'
  }
  if (operation === 'aims.weekly-reporting-period-generate') {
    query.current_user_can_configure_weekly_reports = canConfigure ? '1' : '0'
    if (!isProjectDirector && !canConfigure) {
      throw createError({ statusCode: 403, message: '需要项目总监或项目周报配置权限' })
    }
    if (isProjectDirector && !canConfigure) {
      const holder = await requireCurrentProjectGovernanceRoleHolder(event, 'project_director', uid)
      query.current_user_project_director_revision = String(holder.revision)
    }
    return query
  }
  if (!isProjectDirector) {
    throw createError({ statusCode: 403, message: '仅当前项目总监可以审阅项目周报' })
  }
  // 总监工作台是只读汇总，独立应用同样只按 review 权限放行，不读持有人。
  if (operation === 'aims.weekly-reporting-period-workbench') return query
  const holder = await requireCurrentProjectGovernanceRoleHolder(event, 'project_director', uid)
  query.current_user_project_director_revision = String(holder.revision)
  return query
}

function withoutGovernanceKeys(query: Record<string, string>) {
  return Object.fromEntries(Object.entries(query).filter(([key]) => !governanceQueryKeySet.has(key)))
}

interface WeeklyContext {
  user: Awaited<ReturnType<typeof requireEnterpriseUser>>
  governance: Record<string, string>
  scope?: Record<string, string>
}

// 已验证会话 + 周报资源授权 + 项目总监持有人，只算一次；发布编排复用同一上下文
// 先读汇总再发布，不重复向 Console 读持有人。
async function weeklyContext(event: H3Event, operation: WeeklyOperation): Promise<WeeklyContext> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const write = !readOperations.has(operation)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const action = write ? 'edit' : 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'reports', action, authorization.actionPolicies?.reports)) {
    throw createError({ statusCode: 403, message: write ? '无周报编辑权限' : '无周报查看权限' })
  }
  const governance = await weeklyGovernanceQuery(event, operation, user.uid, authorization)
  return { user, governance }
}

async function weeklyRuntime<T>(event: H3Event, operation: WeeklyOperation, context: WeeklyContext, call: WeeklyCall = {}): Promise<T> {
  const { user, governance } = context
  const write = !readOperations.has(operation)
  await prepareEnterpriseRuntime(event, operation)
  context.scope ??= await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.code ? { code: call.code } : {}),
    ...(call.objectId ? { objectId: call.objectId } : {}),
    query: { ...withoutGovernanceKeys({ ...(call.query || {}), ...context.scope }), ...governance, ...(call.trustedQuery || {}) },
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

async function weeklyCall<T>(event: H3Event, operation: WeeklyOperation, call: WeeklyCall = {}): Promise<T> {
  return await weeklyRuntime<T>(event, operation, await weeklyContext(event, operation), call)
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
  if (operation === 'aims.company-weekly-summary-publish') return await publishCompanyWeeklySummary(event, code)
  if (operation === 'aims.company-weekly-summary-retry' || operation === 'aims.company-weekly-summary-cancel-publish') {
    // Runtime 按周期定位待投递版本，不读取任何请求体字段；不转发浏览器 payload。
    const result = await weeklyCall<RuntimeEnvelope<Record<string, unknown>>>(event, operation, {
      code, payload: {}, idempotencyKey: `${operation}:${code}`
    })
    if (operation === 'aims.company-weekly-summary-cancel-publish') return result
    return { code: 0, data: { ...(result?.data || {}), delivery: queuedDelivery(result?.data?.operationKey) } }
  }
  return await weeklyCall(event, operation, {
    code, payload: await payloadOf(event), idempotencyKey: `${operation}:${code}`
  })
}

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
}

interface CompanyWeeklySummaryView {
  generated?: boolean
  recipientSelections?: unknown
}

// 投递由正式 Aims worker 经统一调度领取 outbox 后完成（claim → 读取不可变正文 →
// Codocs Service API → succeed），宿主请求内不同步投递；前端据 pending 提示后台处理。
function queuedDelivery(operationKey: unknown) {
  return { linked: Boolean(text(operationKey)), synced: false, pending: true }
}

function recipientResolutionError(error: unknown) {
  const statusCode = Number((error as { statusCode?: unknown })?.statusCode)
  // 409 是抄送清单本身失效（离职、部门不存在或无人），文案只含用户自选的名称。
  if (statusCode === 409) return error
  return createError({
    statusCode: 503,
    message: '抄送人员目录暂不可用，请稍后重试',
    data: { code: 'company_summary_recipient_directory_unavailable', message: '抄送人员目录暂不可用，请稍后重试' }
  })
}

/**
 * 与独立 Aims BFF 发布路由同一编排：抄送选择只取 Runtime 当前汇总投影（不信任浏览器），
 * 经 Console 目录服务读取展开为 active UID 快照，随后才写入
 * company_summary_recipient_resolution_verified；Aims 在同一事务内冻结周报、写版本与
 * 收件人快照并登记 Codocs 投递 outbox。项目经理职责工时在 worker 回执 succeed 时确认。
 */
async function publishCompanyWeeklySummary(event: H3Event, code: string) {
  const operation: WeeklyOperation = 'aims.company-weekly-summary-publish'
  const context = await weeklyContext(event, operation)
  const body = await payloadOf(event)
  const correctionReason = text(body.correctionReason)
  if (correctionReason.length > 2000) throw createError({ statusCode: 400, message: '更正原因不能超过 2000 字' })
  const view = await weeklyRuntime<RuntimeEnvelope<CompanyWeeklySummaryView>>(event, 'aims.company-weekly-summary-view', context, { code })
  if (!view?.data?.generated) throw createError({ statusCode: 409, message: '请先生成公司项目周报汇总草稿' })
  const recipients = await resolveCompanyWeeklySummaryRecipients(event, view.data.recipientSelections)
    .catch((error: unknown) => { throw recipientResolutionError(error) })
  const prepared = await weeklyRuntime<RuntimeEnvelope<Record<string, unknown> & { operation?: { operationKey?: unknown } }>>(event, operation, context, {
    code,
    trustedQuery: { company_summary_recipient_resolution_verified: '1' },
    payload: {
      ...(correctionReason ? { correctionReason } : {}),
      resolvedRecipients: recipients.resolvedRecipients,
      coveredSelectionKeys: recipients.coveredSelectionKeys
    },
    idempotencyKey: `${operation}:${code}`
  })
  const data = prepared?.data || {}
  return { code: 0, data: { ...data, delivery: queuedDelivery(data.operation?.operationKey) } }
}

export async function enterpriseAimsWeeklyPeriodWorkbench(event: H3Event) {
  const code = requirePeriod(event)
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    // 与独立 BFF 一致：调用方自带的治理标志静默丢弃，不能进入 Runtime。
    if (governanceQueryKeySet.has(key)) continue
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
  if (!authorizationResourcesAllow(authorization.resources, 'weekly_reports', 'submit', authorization.actionPolicies?.weekly_reports)) {
    throw createError({ statusCode: 403, message: '无项目周报提交权限' })
  }
  const projectWriteAuthorization = {
    ...await loadProjectCommandAuthorization(event, user, { resource: 'reports', action: 'edit', projectId, workItemId: '' }),
    objectId: '', subId: ''
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
    weeklyReportSubmitAuthorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'weekly_reports', action: 'submit', projectId,
      expiresAt: enterpriseRuntimePermitExpiresAt()
    },
    projectWriteAuthorization,
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
