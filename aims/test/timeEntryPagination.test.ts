import test from 'node:test'
import assert from 'node:assert/strict'
import { editedDayHours, isTimeEntryPage, projectTimeWeekWindow, refreshTimeEntryDraftBaselines } from '../app/utils/timeEntryPagination'
import { timeEntryReadQuery } from '../../foundation/shared/utils/timeEntryReadQuery'

test('project week uses configured reporting timezone and ISO Monday across browser zones', () => {
  const previousZone = process.env.TZ
  try {
    for (const browserZone of ['UTC', 'America/Halifax', 'Asia/Shanghai']) {
      process.env.TZ = browserZone
      assert.deepEqual(projectTimeWeekWindow(new Date('2026-09-29T12:00:00Z'), 'Asia/Shanghai'), { todayDate: '2026-09-29', weekStart: '2026-09-28', weekEnd: '2026-10-04' })
      assert.deepEqual(projectTimeWeekWindow(new Date('2026-09-27T18:00:00Z'), 'Asia/Shanghai'), { todayDate: '2026-09-28', weekStart: '2026-09-28', weekEnd: '2026-10-04' })
      assert.deepEqual(projectTimeWeekWindow(new Date('2027-01-03T12:00:00Z'), 'UTC'), { todayDate: '2027-01-03', weekStart: '2026-12-28', weekEnd: '2027-01-03' })
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ
    else process.env.TZ = previousZone
  }
})

test('day editing adjusts the full baseline, including records on other pages', () => {
  assert.equal(editedDayHours(23.9, [{ hours: 1.1, originalHours: 0.1 }]), 24.9)
  assert.equal(editedDayHours(23.9, [{ hours: 0, originalHours: 0.1 }]), 23.8)
})

test('time-entry read query rejects browser authorization, malformed windows and unbounded pages', () => {
  const good = { page: '2', pageSize: '100', startDate: '2026-08-31', endDate: '2026-10-04', monthStart: '2026-09-01', monthEnd: '2026-09-30', weekStart: '2026-09-21', weekEnd: '2026-09-27', todayDate: '2026-09-27', calendarProjectId: '12' }
  assert.deepEqual(timeEntryReadQuery(good, 'user'), good)
  for (const query of [{ pageSize: '101' }, { page: ['1', '2'] }, { page: '01' }, { page: '1', startDate: '2026-02-30' }, { page: '1', monthStart: '2026-09-01', monthEnd: '2026-10-01' }, { page: '1', weekStart: '2026-09-21', weekEnd: '2026-10-04' }, { page: '1', weekStart: '2026-09-29', weekEnd: '2026-10-05' }, { todayDate: '2026-09-27' }, { page: '1', current_user_can_approve_timesheet: '1' }, { page: '1', periodKey: '2026-W39' }, { page: '1', current_user: 'other' }, { page: '1', projectId: '9007199254740992' }]) assert.throws(() => timeEntryReadQuery(query, 'user'))
  assert.throws(() => timeEntryReadQuery({ page: '1', projectId: '12' }, 'project'))
})

test('page validation requires full summaries and never accepts a legacy or mismatched page', () => {
  const summary = { totalHours: 27.25, monthHours: 18, todayHours: 3, weekHours: 3, positiveDays: 4, monthPositiveDays: 2, monthMissingDays: 25, dailyHours: [], dailyProjectHours: [], baseDailyProjectHours: [], weeklyHours: [], projectHours: [], weekStatusCounts: { draft: 0, returned: 0, submitted: 0, approved: 0 } }
  const page = { items: [], total: 110, page: 2, pageSize: 20, summary }
  assert.equal(isTimeEntryPage(page, 2, 20), true)
  assert.equal(isTimeEntryPage({ ...page, summary: undefined }, 2, 20), false)
  assert.equal(isTimeEntryPage(page, 1, 20), false)
  assert.equal(isTimeEntryPage({ ...page, summary: { ...summary, monthHours: NaN } }, 2, 20), false)
})

test('summary arrival updates the selected day baseline without losing a partially entered draft', () => {
  const rows = [{ projectId: 12, hours: 2, percent: 25, existingHours: 0 }]
  const updated = refreshTimeEntryDraftBaselines(rows, [{ date: '2026-09-27', projectId: 12, projectCode: 'P12', projectName: 'Project', hours: 6, entryCount: 105 }], '2026-09-27')
  assert.deepEqual(updated, [{ projectId: 12, hours: 2, percent: 25, existingHours: 6 }])
  assert.equal(rows[0]!.existingHours, 0)
  assert.equal(refreshTimeEntryDraftBaselines(rows, [], '2026-09-28')[0]!.existingHours, 0)
})

test('review pagination requires complete status counts independent of this page', async () => {
  const { isTimeEntryReviewPage } = await import('../app/utils/timeEntryPagination')
  const { timeEntryReviewQuery } = await import('../../foundation/shared/utils/timeEntryReviewQuery')
  const page = { periodKey: '2026-W39', items: [], total: 107, page: 2, pageSize: 100, statusCounts: { submitted: 105, approved: 1, returned: 1 } }
  assert.equal(isTimeEntryReviewPage(page, 2, 100), true)
  assert.equal(isTimeEntryReviewPage({ ...page, statusCounts: { submitted: 7, approved: 0, returned: 0 } }, 2, 100), false)
  assert.deepEqual(timeEntryReviewQuery({ periodKey: '2020-W53', page: '2', pageSize: '100' }), { periodKey: '2020-W53', page: '2', pageSize: '100' })
  for (const query of [{ periodKey: '2021-W53' }, { periodKey: '2026-W00' }, { periodKey: '2026-W39', pageSize: '101' }, { periodKey: '2026-W39', period_key: '2026-W39' }, { periodKey: '2026-W39', current_user_can_review_assigned_timesheet: '1' }]) assert.throws(() => timeEntryReviewQuery(query))
})
