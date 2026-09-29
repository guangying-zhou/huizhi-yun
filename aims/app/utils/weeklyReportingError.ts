// 周报周期与周报设置相关的失败提示。
//
// 按 Host / Runtime 业务错误合同（foundation/shared/utils/enterpriseBusinessError.ts）
// 只读取稳定机器码并映射为中文说明，不展示服务端 message（独立部署下可能是
// 英文诊断文本）。码表来源：data-runtime/internal/apps/aims/
// project_governance_responsibility.go（设置读写、周期生成）与
// project_weekly_report_governance.go（总监工作台）。
import { safeEnterpriseErrorCode } from '../../../foundation/shared/utils/enterpriseBusinessError'

export const weeklyReportingNotConfiguredMessage = '周报设置尚未配置，请联系管理员在「周报设置」中完成配置'

export const weeklyReportingMessages: Readonly<Record<string, string>> = Object.freeze({
  weekly_reporting_not_configured: weeklyReportingNotConfiguredMessage,
  weekly_reporting_disabled: '周报填报已停用，请联系管理员在「周报设置」中调整启用范围',
  weekly_reporting_period_required: '本周尚未生成应报清单，请联系项目总监或周报管理员先生成',
  weekly_period_generate_required: '仅项目总监或周报配置管理员可以生成应报清单',
  weekly_reporting_configure_required: '当前账号没有项目周报配置权限',
  invalid_period_key: '所选周无效，请重新选择',
  invalid_period_timezone: '周报设置中的时区无效，请联系管理员在「周报设置」中修正',
  timezone_required: '请选择时区',
  invalid_timezone: '时区无效，请重新选择',
  invalid_deadline_weekday: '填报截止星期无效',
  invalid_summary_target_weekday: '汇总目标星期无效',
  invalid_weekly_reporting_time: '时间格式无效，请使用 HH:mm',
  invalid_rollout_mode: '启用范围无效',
  invalid_reminder_offsets: '现有提醒配置格式无效，请联系系统管理员',
  invalid_rag_config: '现有 RAG 配置格式无效，请联系系统管理员',
  missing_current_user: '登录状态已失效，请重新登录',
  console_session_verification_unavailable: '登录状态暂时无法核验，请稍后重试',
  enterprise_document_storage_unavailable: '文档存储服务暂时不可用，请稍后重试'
})

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** 从 $fetch 错误中读取机器码：Host/独立部署在 data.data.code，hzy0 网关同时给出 data.code。 */
export function aimsApiErrorCode(error: unknown): string {
  const body = record(record(error).data)
  const nested = record(body.data)
  return safeEnterpriseErrorCode(nested.code ?? body.code)
}

export function aimsApiErrorStatus(error: unknown): number {
  const root = record(error)
  const body = record(root.data)
  const response = record(root.response)
  return Number(root.statusCode ?? root.status ?? response.status ?? body.statusCode ?? 0) || 0
}

/** 已知周报业务码的中文说明；未知码返回空串，由调用方按场景兜底。 */
export function weeklyReportingCodeMessage(error: unknown): string {
  return weeklyReportingMessages[aimsApiErrorCode(error)] || ''
}

/**
 * 总监工作台：周期不存在（Runtime 409 weekly_reporting_period_required，旧版本
 * 为 404）表示“应报清单未生成”，页面应提供生成入口而不是报错。
 */
export function isWeeklyPeriodNotReady(error: unknown): boolean {
  const status = aimsApiErrorStatus(error)
  if (status === 404) return true
  return status === 409 && aimsApiErrorCode(error) === 'weekly_reporting_period_required'
}

export function weeklyReportingErrorMessage(error: unknown, fallback: string): string {
  const known = weeklyReportingCodeMessage(error)
  if (known) return known
  const status = aimsApiErrorStatus(error)
  if (status === 401) return '登录状态已失效，请重新登录'
  if (status === 403) return '当前账号没有该操作的权限'
  if (status === 409) return '当前业务状态不允许该操作，请刷新后重试'
  if (status === 429 || status >= 500) return '服务暂时不可用，请稍后重试'
  return fallback
}
