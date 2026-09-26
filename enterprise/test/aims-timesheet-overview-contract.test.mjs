import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertMigratedPage } from './helpers/migrated-page.mjs'
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('timesheet overview is one self query with project visibility filtering', () => {
  const source = read('../data-runtime/internal/apps/aims/time_entries.go')
  const bff = read('server/utils/enterpriseAimsTimesheetOverview.ts')
  assert.match(source, /userVisibleTimeEntries/)
  assert.match(source, /projectVisibilityWhere/)
  assert.match(source, /EXISTS \(SELECT 1 FROM aims_projects/)
  assert.match(source, /uid != currentUser/)
  assert.match(bff, /enterpriseAimsProjectScope/)
  assert.doesNotMatch(bff, /projects\/.+time-entries/)
})

// 原断言锁的是薄改写页"不提供填报或审批"。按"复用原页面"切换后这个前提不成立
// ——原工时页本就包含填报与审批。改为守护迁移不变量，并要求写入路径经过
// 宿主 BFF 的授权判定，而不是页面层限制。
test('timesheet pages serve the original Aims pages with a host-safe closure', () => {
  assertMigratedPage({ route: '/timesheet', name: 'timesheet', source: 'timesheet' })
  assertMigratedPage({ route: '/projects/:id/timesheet', name: 'project-timesheet', source: 'projects/[id]/timesheet' })
  assertMigratedPage({ route: '/work-items', name: 'work-items', source: 'work-items' })

  const bff = read('server/utils/enterpriseAimsTimesheet.ts')
  assert.match(bff, /authorizationResourcesAllow\(authorization\.resources, resource, action/)
  assert.match(bff, /enterpriseAimsProjectScope/)
  // uid 只决定查询目标，不决定授权
  assert.match(bff, /uid 只决定查询目标、不决定授权/)
})
