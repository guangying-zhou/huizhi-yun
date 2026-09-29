import { createError, getHeader, getQuery, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

// 周报设置（公司级单行配置）的 Host 桥。
//
// 与独立 Aims BFF applyProjectGovernanceRoleContext 的 settingsPath 同一口径：
// 只有 weekly_reports:configure 可读写；current_user_can_configure_weekly_reports
// 由宿主按已验证会话写入，调用方自带的治理标志一律丢弃。Runtime 另外核对
// 人员许可 weekly-reporting-settings/configure、签名 actor 与部署绑定。

type SettingsOperation = 'aims.weekly-reporting-settings-view' | 'aims.weekly-reporting-settings-update'

// 与 enterpriseAimsWeeklyGovernance.ts 相同的治理标志集合：静默丢弃，不进入 Runtime。
const governanceQueryKeys = new Set([
  'current_user_is_project_director', 'currentUserIsProjectDirector',
  'current_user_project_director_revision', 'currentUserProjectDirectorRevision',
  'current_user_can_configure_weekly_reports', 'currentUserCanConfigureWeeklyReports',
  'current_user_can_submit_weekly_report', 'currentUserCanSubmitWeeklyReport',
  'current_user_can_submit_assigned_weekly_report', 'currentUserCanSubmitAssignedWeeklyReport',
  'current_user', 'operator_uid'
])

const clientKeyPattern = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/
const timezonePattern = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/
const rolloutModes = new Set(['disabled', 'pilot', 'company'])
const payloadFields = new Set([
  'timezone', 'deadlineWeekday', 'deadlineTime', 'summaryTargetWeekday', 'summaryTargetTime',
  'rolloutMode', 'reminderOffsets', 'ragConfig'
])
const maxJsonBytes = 4096

function rejectQuery(event: H3Event) {
  for (const key of Object.keys(getQuery(event))) {
    if (!governanceQueryKeys.has(key)) throw createError({ statusCode: 400, message: '周报设置不支持查询参数' })
  }
}

async function requireConfigurator(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'weekly_reports', 'configure', authorization.actionPolicies?.weekly_reports)) {
    throw createError({ statusCode: 403, message: '需要项目周报配置权限' })
  }
  return user
}

function weekday(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 7) {
    throw createError({ statusCode: 400, message: `${field}无效` })
  }
  return value
}

function clock(value: unknown, field: string) {
  if (typeof value !== 'string' || !clockPattern.test(value)) throw createError({ statusCode: 400, message: `${field}无效` })
  return value
}

function jsonDocument(value: unknown, field: string, kind: 'array' | 'object') {
  const ok = kind === 'array' ? Array.isArray(value) : Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  if (!ok || new TextEncoder().encode(JSON.stringify(value)).length > maxJsonBytes) {
    throw createError({ statusCode: 400, message: `${field}无效` })
  }
  return value
}

/** Whitelisted full-replace payload; the Runtime still validates timezone/time semantics. */
export function weeklyReportingSettingsPayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw createError({ statusCode: 400, message: '周报设置内容无效' })
  const body = input as Record<string, unknown>
  if (Object.keys(body).some(field => !payloadFields.has(field))) throw createError({ statusCode: 400, message: '周报设置字段无效' })
  if (typeof body.timezone !== 'string' || !timezonePattern.test(body.timezone)) throw createError({ statusCode: 400, message: '时区无效' })
  if (typeof body.rolloutMode !== 'string' || !rolloutModes.has(body.rolloutMode)) throw createError({ statusCode: 400, message: '启用范围无效' })
  const payload: Record<string, unknown> = {
    timezone: body.timezone,
    deadlineWeekday: weekday(body.deadlineWeekday, '截止星期'),
    deadlineTime: clock(body.deadlineTime, '截止时间'),
    summaryTargetWeekday: weekday(body.summaryTargetWeekday, '汇总目标星期'),
    summaryTargetTime: clock(body.summaryTargetTime, '汇总目标时间'),
    rolloutMode: body.rolloutMode
  }
  if (body.reminderOffsets !== undefined && body.reminderOffsets !== null) payload.reminderOffsets = jsonDocument(body.reminderOffsets, '提醒配置', 'array')
  if (body.ragConfig !== undefined && body.ragConfig !== null) payload.ragConfig = jsonDocument(body.ragConfig, 'RAG 配置', 'object')
  return payload
}

type Configurator = Awaited<ReturnType<typeof requireConfigurator>>

async function settingsCall(event: H3Event, user: Configurator, operation: SettingsOperation, payload?: Record<string, unknown>, idempotencyKey?: string) {
  await prepareEnterpriseRuntime(event, operation)
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    query: { current_user_can_configure_weekly_reports: '1' },
    ...(payload ? { payload } : {}),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'weekly-reporting-settings',
      action: 'configure',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, idempotencyKey ? { idempotencyKey } : {})
}

export async function enterpriseAimsWeeklyReportingSettings(event: H3Event) {
  rejectQuery(event)
  return await settingsCall(event, await requireConfigurator(event), 'aims.weekly-reporting-settings-view')
}

/**
 * Full replace of the company row. The browser keeps one key per save intent
 * (reused on retry, replaced after success or edits); the Runtime requires it.
 */
export async function enterpriseAimsWeeklyReportingSettingsUpdate(event: H3Event) {
  rejectQuery(event)
  const key = String(getHeader(event, 'Idempotency-Key') || '')
  if (!clientKeyPattern.test(key)) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const user = await requireConfigurator(event)
  const payload = weeklyReportingSettingsPayload(await readBody(event).catch(() => null))
  return await settingsCall(event, user, 'aims.weekly-reporting-settings-update', payload, `aims.weekly-reporting-settings:${key}`)
}
