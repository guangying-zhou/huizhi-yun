import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isoWeekDateRange, normalizeIsoWeekInput, shiftIsoWeek } from '../app/utils/isoWeek'

const page = readFileSync(new URL('../app/pages/weekly-reports.vue', import.meta.url), 'utf8')

test('ISO week date range matches the Runtime isoWeekRange calendar', () => {
  assert.deepEqual(isoWeekDateRange(2026, 39), { start: '2026-09-21', end: '2026-09-27' })
  assert.deepEqual(isoWeekDateRange(2026, 40), { start: '2026-09-28', end: '2026-10-04' })
  assert.deepEqual(isoWeekDateRange(2026, 41), { start: '2026-10-05', end: '2026-10-11' })
  assert.deepEqual(isoWeekDateRange(2026, 53), { start: '2026-12-28', end: '2027-01-03' })
  assert.deepEqual(isoWeekDateRange(2021, 1), { start: '2021-01-04', end: '2021-01-10' })
  assert.deepEqual(isoWeekDateRange(2020, 53), { start: '2020-12-28', end: '2021-01-03' })
  // Same algorithm as the Runtime (UTC calendar, week 1 contains Jan 4).
  const runtime = readFileSync(new URL('../../data-runtime/internal/apps/aims/project_weekly_reports.go', import.meta.url), 'utf8')
  assert.match(runtime, /func isoWeekRange\(year int, week int\) \(time\.Time, time\.Time\) \{\s*jan4 := time\.Date\(year, time\.January, 4, 0, 0, 0, 0, time\.UTC\)/)
})

test('the range does not depend on the browser time zone', () => {
  const original = process.env.TZ
  try {
    for (const zone of ['Pacific/Kiritimati', 'America/Sao_Paulo', 'Asia/Shanghai', 'Pacific/Pago_Pago']) {
      process.env.TZ = zone
      assert.deepEqual(isoWeekDateRange(2026, 40), { start: '2026-09-28', end: '2026-10-04' }, zone)
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
})

test('arrows and typed input normalize across year boundaries', () => {
  assert.deepEqual(shiftIsoWeek(2026, 39, 1), { year: 2026, week: 40 })
  assert.deepEqual(shiftIsoWeek(2026, 53, 1), { year: 2027, week: 1 })
  assert.deepEqual(shiftIsoWeek(2027, 1, -1), { year: 2026, week: 53 })
  assert.deepEqual(shiftIsoWeek(2025, 52, 1), { year: 2026, week: 1 })
  assert.deepEqual(normalizeIsoWeekInput('2026', '40'), { year: 2026, week: 40 })
  assert.deepEqual(normalizeIsoWeekInput(2026, 41), { year: 2026, week: 41 })
  assert.deepEqual(normalizeIsoWeekInput(2025, 53), { year: 2026, week: 1 }, '2025 has 52 ISO weeks')
  for (const [year, week] of [[2026, ''], [2026, 0], [2026, 54], ['', 40], [1969, 1], [2026, '4.5'], [2026, '-1'], ['20x6', 40]] as const) {
    assert.equal(normalizeIsoWeekInput(year, week), null, `${year}-W${week}`)
  }
})

test('typing a week debounces into one selection change that resets paging and loads once', () => {
  // Inputs edit drafts, not the selected week, so keystrokes never request.
  assert.equal((page.match(/v-model="weekInput"/g) || []).length, 2)
  assert.equal((page.match(/v-model="yearInput"/g) || []).length, 2)
  assert.doesNotMatch(page, /v-model="selected(?:Week|Year)"/)
  const inputWatch = page.slice(page.indexOf('watchDebounced([yearInput, weekInput]'), page.indexOf('watch(summaryRead.fingerprint'))
  assert.match(inputWatch, /String\(yearInput\.value\) === String\(selectedYear\.value\) && String\(weekInput\.value\) === String\(selectedWeek\.value\)/)
  assert.match(inputWatch, /applyWeekInput\(\)/)
  assert.equal((page.match(/@keyup\.enter="commitWeekInput"/g) || []).length, 4)
  assert.equal((page.match(/@blur="commitWeekInput"/g) || []).length, 4)
  const weekWatch = page.slice(page.indexOf('watch([selectedYear, selectedWeek], () => {'), page.indexOf('watchDebounced(['))
  assert.match(weekWatch, /if \(page\.value !== 1\) page\.value = 1\s*else loadReports\(\)/)
  // Arrows go through the same selection path instead of loading a second time.
  for (const name of ['prevWeek', 'nextWeek']) {
    const body = page.slice(page.indexOf(`function ${name}()`), page.indexOf('}', page.indexOf(`function ${name}()`)))
    assert.match(body, /selectWeek\(target\.year, target\.week\)/)
    assert.doesNotMatch(body, /loadReports/)
  }
})

test('the header range is derived from the selected ISO week, not the previous response', () => {
  assert.match(page, /const weekRange = computed\(\(\) => isoWeekDateRange\(selectedYear\.value, selectedWeek\.value\)\)/)
  assert.match(page, /:description="`\$\{weekLabel\}（\$\{weekRangeLabel\}）`"/)
  assert.equal((page.match(/\(\{\{ weekRangeLabel \}\}\)/g) || []).length, 2)
  assert.doesNotMatch(page, /data\.meta\.weekStart|weekStart\.value/)
})
