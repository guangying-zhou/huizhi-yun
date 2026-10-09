import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { timesheetWeekSubmitErrorMessage } from '../app/utils/timesheetWeekSubmitError'

// $fetch FetchError shapes: Host / standalone render the h3 envelope
// (code under data.data.code), the hzy0 gateway adds data.code as well.
const hostError = (statusCode: number, code: string, message = 'weekly reporting period is required') =>
  ({ statusCode, data: { statusCode, message, data: { code, message } } })
const gatewayError = (statusCode: number, code: string) =>
  ({ statusCode, data: { statusCode, code, message: '请求与当前业务状态冲突，请刷新后重试', data: { code } } })

test('week submit business codes map to clear Chinese messages on every ingress', () => {
  for (const make of [hostError, gatewayError]) {
    assert.equal(timesheetWeekSubmitErrorMessage(make(409, 'weekly_reporting_period_required')), '所选周尚未生成应报清单，请联系项目总监或周报管理员在「周报汇总」中生成')
    assert.equal(timesheetWeekSubmitErrorMessage(make(409, 'weekly_reporting_not_configured')), '周报设置尚未配置，请联系管理员在「周报设置」中完成配置')
    assert.equal(timesheetWeekSubmitErrorMessage(make(409, 'timesheet_week_has_no_editable_entries')), '所选周没有可提交的草稿或退回工时')
    assert.equal(timesheetWeekSubmitErrorMessage(make(409, 'timesheet_week_changed')), '所选周工时已发生变化，请刷新后重新提交')
    assert.equal(timesheetWeekSubmitErrorMessage(make(409, 'project_manager_required')), '部分工时所属项目未设置项目经理，请联系项目管理员')
    assert.equal(timesheetWeekSubmitErrorMessage(make(400, 'invalid_period_key')), '所选周无效，请重新选择日期')
  }
})

test('every Runtime week-submit code has a mapping', () => {
  const runtime = readFileSync(new URL('../../data-runtime/internal/apps/aims/time_entry_governance.go', import.meta.url), 'utf8')
  const start = runtime.indexOf('func (a *Adapter) submitTimesheetWeek(')
  const end = runtime.indexOf('\nfunc ', start + 1)
  const codes = new Set([...runtime.slice(start, end).matchAll(/httperror\.New\([^,]+,\s*"([a-z_]+)"/g)].map(match => match[1]!))
  assert.ok(codes.has('weekly_reporting_period_required'))
  for (const code of codes) {
    assert.notEqual(timesheetWeekSubmitErrorMessage(hostError(409, code)), '所选周工时状态已变化，请刷新后重试', code)
  }
})

test('unknown codes fall back by status without echoing server text', () => {
  assert.equal(timesheetWeekSubmitErrorMessage(hostError(409, 'something_new', 'SECRET detail')), '所选周工时状态已变化，请刷新后重试')
  assert.equal(timesheetWeekSubmitErrorMessage({ statusCode: 403, data: { message: 'SECRET' } }), '当前账号没有提交该周工时的权限')
  assert.equal(timesheetWeekSubmitErrorMessage({ statusCode: 503, data: { code: 'hzy0_upstream_error', message: 'Local Enterprise request failed' } }), '服务暂时不可用，请稍后重试')
  assert.equal(timesheetWeekSubmitErrorMessage(new Error('network')), '周工时提交失败，请稍后重试')
  assert.equal(timesheetWeekSubmitErrorMessage(null), '周工时提交失败，请稍后重试')
})

test('timesheet page uses the week-submit mapping instead of the server message', () => {
  const page = readFileSync(new URL('../app/pages/timesheet.vue', import.meta.url), 'utf8')
  assert.match(page, /toast\.add\(\{ title: timesheetWeekSubmitErrorMessage\(err\), color: 'error' \}\)/)
  assert.doesNotMatch(page, /data\?\.message \|\| '周工时提交失败'/)
})
