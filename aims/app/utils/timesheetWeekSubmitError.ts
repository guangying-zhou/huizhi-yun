// 周工时提交失败提示。按 Host/Runtime 合同的稳定机器码映射中文说明，
// 不展示服务端 message（独立部署下可能是英文诊断文本）。
// 码表来源：data-runtime/internal/apps/aims/time_entry_governance.go
// submitTimesheetWeek 及其调用的项目范围校验；周期/周报设置相关码与周报页
// 共用 weeklyReportingError.ts 的同一文案。
import { aimsApiErrorCode, aimsApiErrorStatus, weeklyReportingNotConfiguredMessage } from './weeklyReportingError'

const weekSubmitMessages: Readonly<Record<string, string>> = Object.freeze({
  weekly_reporting_period_required: '所选周尚未生成应报清单，请联系项目总监或周报管理员在「周报汇总」中生成',
  weekly_reporting_not_configured: weeklyReportingNotConfiguredMessage,
  invalid_period_timezone: '所选周的填报周期配置有误，请联系项目管理员',
  invalid_period_key: '所选周无效，请重新选择日期',
  timesheet_week_has_no_editable_entries: '所选周没有可提交的草稿或退回工时',
  timesheet_week_changed: '所选周工时已发生变化，请刷新后重新提交',
  project_manager_required: '部分工时所属项目未设置项目经理，请联系项目管理员',
  project_not_found: '部分工时所属项目不存在或已删除，请刷新后重试',
  forbidden_project_timesheet: '您已不是部分项目的成员，无法提交这些项目的工时',
  timesheet_submit_permission_required: '当前账号没有提交工时的权限',
  enterprise_project_command_scope_denied: '没有部分项目的工时提交权限',
  enterprise_project_command_scope_invalid: '项目授权已变化，请刷新后重试',
  enterprise_project_command_scope_expired: '项目授权已过期，请刷新后重试',
  enterprise_project_scope_unavailable: '项目范围暂不可用，请稍后重试',
  missing_current_user: '登录状态已失效，请重新登录',
  authentication_required: '登录状态已失效，请重新登录',
  permission_denied: '当前账号没有提交工时的权限'
})

export function timesheetWeekSubmitErrorMessage(error: unknown): string {
  const known = weekSubmitMessages[aimsApiErrorCode(error)]
  if (known) return known
  const status = aimsApiErrorStatus(error)
  if (status === 401) return '登录状态已失效，请重新登录'
  if (status === 403) return '当前账号没有提交该周工时的权限'
  if (status === 409) return '所选周工时状态已变化，请刷新后重试'
  if (status === 429 || status >= 500) return '服务暂时不可用，请稍后重试'
  return '周工时提交失败，请稍后重试'
}
