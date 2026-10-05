import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { matchRouteRule, routeRuleRequirements } from '../app/config/permissions.ts'
import { isWeeklyPeriodNotReady, weeklyReportingErrorMessage } from '../app/utils/weeklyReportingError'

// $fetch FetchError shapes: Host / standalone render the h3 envelope
// (code under data.data.code), the hzy0 gateway adds data.code as well.
const hostError = (statusCode: number, code: string, message = 'SECRET runtime diagnostic') =>
  ({ statusCode, data: { statusCode, message, data: { code, message } } })
const gatewayError = (statusCode: number, code: string) =>
  ({ statusCode, data: { statusCode, code, message: '请求与当前业务状态冲突，请刷新后重试', data: { code } } })

const settingsPage = readFileSync(new URL('../app/pages/admin/weekly-reporting-settings.vue', import.meta.url), 'utf8')
const weeklyPage = readFileSync(new URL('../app/pages/weekly-reports.vue', import.meta.url), 'utf8')
const entry = readFileSync(new URL('../layer/entry.mjs', import.meta.url), 'utf8')

test('weekly reporting business codes map to clear Chinese text on every ingress', () => {
  for (const make of [hostError, gatewayError]) {
    assert.equal(weeklyReportingErrorMessage(make(409, 'weekly_reporting_not_configured'), 'x'), '周报设置尚未配置，请联系管理员在「周报设置」中完成配置')
    assert.equal(weeklyReportingErrorMessage(make(409, 'weekly_reporting_disabled'), 'x'), '周报填报已停用，请联系管理员在「周报设置」中调整启用范围')
    assert.equal(weeklyReportingErrorMessage(make(409, 'weekly_reporting_period_required'), 'x'), '本周尚未生成应报清单，请联系项目总监或周报管理员先生成')
    assert.equal(weeklyReportingErrorMessage(make(403, 'weekly_reporting_configure_required'), 'x'), '当前账号没有项目周报配置权限')
    assert.equal(weeklyReportingErrorMessage(make(400, 'invalid_timezone'), 'x'), '时区无效，请重新选择')
  }
})

test('unknown or unsafe codes fall back by status without echoing server text', () => {
  assert.equal(weeklyReportingErrorMessage(hostError(409, 'something_new'), '生成失败'), '当前业务状态不允许该操作，请刷新后重试')
  assert.equal(weeklyReportingErrorMessage(hostError(400, 'Bad Code!'), '保存失败'), '保存失败')
  assert.equal(weeklyReportingErrorMessage({ statusCode: 403, data: { message: 'SECRET' } }, 'x'), '当前账号没有该操作的权限')
  assert.equal(weeklyReportingErrorMessage({ statusCode: 503, data: { code: 'hzy0_upstream_error' } }, 'x'), '服务暂时不可用，请稍后重试')
  assert.equal(weeklyReportingErrorMessage(new Error('network'), '生成失败'), '生成失败')
})

test('director workbench treats only a missing period as "not generated"', () => {
  assert.equal(isWeeklyPeriodNotReady(hostError(409, 'weekly_reporting_period_required')), true)
  assert.equal(isWeeklyPeriodNotReady(gatewayError(409, 'weekly_reporting_period_required')), true)
  assert.equal(isWeeklyPeriodNotReady({ statusCode: 404 }), true)
  assert.equal(isWeeklyPeriodNotReady(hostError(409, 'weekly_reporting_not_configured')), false)
  assert.equal(isWeeklyPeriodNotReady({ statusCode: 409 }), false)
  assert.equal(isWeeklyPeriodNotReady({ statusCode: 403 }), false)
  // The Runtime workbench returns this code when the period row is absent (3010d783).
  const runtime = readFileSync(new URL('../../data-runtime/internal/apps/aims/project_weekly_report_governance.go', import.meta.url), 'utf8')
  const start = runtime.indexOf('func (a *Adapter) weeklyReportDirectorWorkbench(')
  assert.match(runtime.slice(start, runtime.indexOf('\nfunc ', start + 1)), /StatusConflict, "weekly_reporting_period_required"/)
})

test('weekly reports page maps workbench and generate failures through the shared contract', () => {
  assert.match(weeklyPage, /if \(isWeeklyPeriodNotReady\(error\)\) \{\s*directorPeriodReady\.value = false/)
  assert.doesNotMatch(weeklyPage, /status === 404 \|\| status === 409/)
  assert.match(weeklyPage, /weeklyReportingErrorMessage\(error, '生成应报责任清单失败'\)/)
  assert.doesNotMatch(weeklyPage, /data\?\.message \|\| '生成应报责任清单失败'/)
  assert.match(weeklyPage, /v-if="periodBlockedByConfiguration && canConfigureWeeklyReports"[\s\S]*?:to="weeklySettingsPath"/)
  assert.match(weeklyPage, /moduleUrl\('\/admin\/weekly-reporting-settings'\)/)
})

test('settings page compiles and is registered in the Host under weekly_reports:configure', () => {
  const filename = 'weekly-reporting-settings.vue'
  const { descriptor, errors } = parse(settingsPage, { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'weekly-reporting-settings' })
  const template = compileTemplate({ filename, id: 'weekly-reporting-settings', source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.match(entry, /page\('\/admin\/weekly-reporting-settings', 'admin-weekly-reporting-settings', 'admin\/weekly-reporting-settings'\)/)
  assert.match(entry, /to: '\/aims\/admin\/weekly-reporting-settings', permission: \{ resource: 'weekly_reports', action: 'configure' \}/)
  for (const path of ['/admin/weekly-reporting-settings', '/aims/admin/weekly-reporting-settings']) {
    assert.deepEqual(routeRuleRequirements(matchRouteRule(path)!), [{ resource: 'weekly_reports', action: 'configure' }])
  }
})

test('settings page saves a whitelisted full replace with one key per intent', () => {
  assert.match(settingsPage, /moduleUrl\('\/api\/v1\/admin\/weekly-reporting-settings'\)/)
  assert.match(settingsPage, /method: 'PUT',\s*headers: \{ 'Idempotency-Key': operation\.key \}/)
  assert.match(settingsPage, /key: crypto\.randomUUID\(\)/)
  // Uncertain outcomes keep the pending intent for a same-key retry; definitive failures drop it.
  assert.match(settingsPage, /if \(!status \|\| status >= 500 \|\| status === 429\) \{\s*saveError\.value = '保存结果未确认/)
  assert.match(settingsPage, /\} else \{\s*pendingWrite\.value = null/)
  assert.match(settingsPage, /tone: 'warning'/)
  assert.match(settingsPage, /weeklyReportingErrorMessage\(cause, '保存失败，请检查填写内容'\)/)
  assert.doesNotMatch(settingsPage, /data\?\.message/)
  assert.doesNotMatch(settingsPage, /current_user_can_configure_weekly_reports/)
  assert.doesNotMatch(settingsPage, /\bconfirm\(\s*['"`]/)
})
