import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  currentWeekRange, dueLabel, greetingFor, isoWeekNumber, relativeTime, sumEntryHours, workItemsForTab
} from '../app/utils/workbench.ts'

// Friday 2026-09-25 15:00 local time; that week runs Monday 09-21 to Sunday 09-27.
const now = new Date(2026, 8, 25, 15, 0)

test('week range, ISO week and greeting follow local time', () => {
  assert.deepEqual(currentWeekRange(now), { startDate: '2026-09-21', endDate: '2026-09-27', today: '2026-09-25' })
  assert.deepEqual(currentWeekRange(new Date(2026, 8, 27, 23, 0)).startDate, '2026-09-21')
  assert.equal(isoWeekNumber(now), 39)
  assert.equal(greetingFor(now), '下午好')
  assert.equal(greetingFor(new Date(2026, 8, 25, 9)), '上午好')
})

test('work tabs keep open items only and sort by due date', () => {
  const items = [
    { id: 1, projectId: 1, projectName: 'P', itemKey: 'A-1', title: 'done', status: 'completed', dueDate: '2026-09-22' },
    { id: 2, projectId: 1, projectName: 'P', itemKey: 'A-2', title: 'late', status: 'in_progress', dueDate: '2026-09-20' },
    { id: 3, projectId: 1, projectName: 'P', itemKey: 'A-3', title: 'next week', status: 'todo', dueDate: '2026-10-02' },
    { id: 4, projectId: 1, projectName: 'P', itemKey: 'A-4', title: 'review', status: 'in_review', dueDate: '2026-09-26' },
    { id: 5, projectId: 1, projectName: 'P', itemKey: 'A-5', title: 'no due', status: 'todo', dueDate: null }
  ]
  assert.deepEqual(workItemsForTab(items, 'active', now).map(item => item.id), [2, 3, 5])
  assert.deepEqual(workItemsForTab(items, 'dueThisWeek', now).map(item => item.id), [2, 4])
  assert.deepEqual(workItemsForTab(items, 'inReview', now).map(item => item.id), [4])
})

test('due labels flag today and overdue; relative times are coarse', () => {
  assert.deepEqual(dueLabel('2026-09-20', now), { text: '逾期 9/20', overdue: true })
  assert.deepEqual(dueLabel('2026-09-25T00:00:00Z', now), { text: '今天', overdue: true })
  assert.deepEqual(dueLabel('2026-10-02', now), { text: '10/2', overdue: false })
  assert.deepEqual(dueLabel(null, now), { text: '—', overdue: false })
  assert.equal(relativeTime(new Date(now.getTime() - 5 * 60000).toISOString(), now), '5 分钟前')
  assert.equal(relativeTime(new Date(now.getTime() - 26 * 3600000).toISOString(), now), '昨天')
  assert.equal(relativeTime('not a date', now), '')
})

test('weekly hours tolerate array and page payloads and ignore invalid rows', () => {
  assert.equal(sumEntryHours([{ hours: 2.5 }, { hours: '1.5' }, { hours: -1 }, {}]), 4)
  assert.equal(sumEntryHours({ items: [{ hours: 8 }, { hours: 0.5 }] }), 8.5)
  assert.equal(sumEntryHours(null), 0)
})

test('workbench only reads authorized sources and reuses Foundation empty states', () => {
  const page = readFileSync(new URL('../app/pages/index.vue', import.meta.url), 'utf8')
  for (const id of ['aims.delivery.execution.work-items', 'aims.delivery.project.projects', 'aims.delivery.execution.timesheet']) {
    assert.match(page, new RegExp(`entryById\\.value\\.has\\('${id.replaceAll('.', '\\.')}'\\)`))
  }
  assert.match(page, /immediate: false, query: computed\(\(\) => \(\{ filter: 'assigned'/)
  assert.match(page, /if \(user && allowed && workStatus\.value === 'idle'\) void loadWork\(\)/)
  assert.match(page, /<CommonEmptyState/)
  assert.doesNotMatch(page, /\bconfirm\(|\balert\(|\bprompt\(/)
})
