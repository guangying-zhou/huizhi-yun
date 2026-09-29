import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// 没有 timesheet:submit 的账号（只读或无权）不能再打开填报对话框后才被 403 拦下：
// 所有写入口按同一权限禁用，并给出明确的无权原因。有 submit 时行为不变。
const page = readFileSync(new URL('../app/pages/timesheet.vue', import.meta.url), 'utf8')

function buttonWith(marker: string) {
  const at = page.indexOf(marker)
  assert.notEqual(at, -1, `missing ${marker}`)
  const start = page.lastIndexOf('<UButton', at)
  const end = page.indexOf('/>', at)
  return page.slice(start, end)
}

test('timesheet write entry points are gated on the loaded timesheet:submit permission', () => {
  assert.match(page, /const \{ loaded: permissionsLoaded, loadPermissions, hasPermission, error: permissionsError \} = usePermissions\(\)/)
  assert.match(page, /const canSubmitTimesheet = computed\(\(\) => permissionsLoaded\.value && hasPermission\('timesheet', 'submit'\)\)/)
  assert.match(page, /permissionsLoaded\.value \? undefined : loadPermissions\(\)/)

  const report = buttonWith('@click.stop="openReportModal(day.dateKey)"')
  assert.match(report, /label="填报"/)
  assert.match(report, /:disabled="!canSubmitTimesheet"/)
  assert.match(report, /:title="submitPermissionDenied \? SUBMIT_PERMISSION_DENIED_REASON : undefined"/)

  assert.match(buttonWith('@click="openReportFromDetail"'), /:disabled="!canSubmitTimesheet \|\| detailSubmitting/)
  assert.equal(page.match(/:disabled="!!weekSubmitDisabledReason \|\| weekSubmitting"/g)?.length, 3, 'header, sidebar and confirm week-submit buttons')

  // 入口函数本身也拒绝，按钮之外的调用路径同样打不开对话框。
  assert.match(page, /function openReportModal\(dateKey: string\) \{\n {2}if \(!canSubmitTimesheet\.value\) return/)
  assert.match(page, /const detailSubmitDisabled = computed\(\(\) => \{\n {2}if \(!canSubmitTimesheet\.value\) return true/)
})

test('disabled week submission explains permission, future week and missing draft beside both buttons', () => {
  assert.match(page, /if \(submitPermissionDenied\.value\) return SUBMIT_PERMISSION_DENIED_REASON/)
  assert.match(page, /selectedWeekRange\.value\.start > todayKey\.value\) return '不能提交未来周'/)
  assert.match(page, /selectedWeekEditableCount\.value === 0\) return '所选周尚无可提交的草稿工时'/)
  assert.equal(page.match(/<p v-if="weekSubmitDisabledReason"[^>]*role="status"/g)?.length, 2)
  assert.equal(page.match(/:title="weekSubmitDisabledReason \|\| undefined"/g)?.length, 2)
  assert.match(page, /async function submitSelectedWeek\(\) \{\n {2}if \(weekSubmitDisabledReason\.value\) return/)
})

test('a user without timesheet:submit sees a no-permission reason, not a silent disabled save', () => {
  // 权限快照加载失败不是“无权”：入口仍禁用，但不显示无权原因。
  assert.match(page, /const submitPermissionDenied = computed\(\(\) => permissionsLoaded\.value && !permissionsError\.value && !canSubmitTimesheet\.value\)/)
  const banner = page.indexOf('data-testid="timesheet-submit-permission-denied"')
  assert.notEqual(banner, -1)
  const alert = page.slice(page.lastIndexOf('<UAlert', banner), banner)
  assert.match(alert, /v-else-if="submitPermissionDenied"/)
  assert.match(alert, /title="无工时填报权限"/)
  assert.match(alert, /:description="SUBMIT_PERMISSION_DENIED_REASON"/)
  // 无查看权限（403）时仍只显示原“无权查看工时”提示。
  assert.ok(page.lastIndexOf('v-if="calendarForbidden"', banner) > page.lastIndexOf('<div class="@container', banner))
})
