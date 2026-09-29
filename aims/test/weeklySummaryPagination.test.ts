import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isWeeklySummaryPage } from '../app/utils/weeklyReportSummaryPage'

test('weekly page requires complete server statistics and bounded full-set charts', () => {
  const v = { items: [], total: 106, page: 2, pageSize: 20, summary: { total: 106, filled: 105, currentDays: 105, actualDays: 0.5, previousDays: 2, deltaDays: 103, memberSlots: 106, cumulativeLaborCost: 1050000 }, charts: { workload: [], members: [], change: [], cost: [] }, meta: { weekStart: '2025-12-29', weekEnd: '2026-01-04' } }
  assert.equal(isWeeklySummaryPage(v, 2, 20), true)
  assert.equal(isWeeklySummaryPage({ ...v, summary: undefined }, 2, 20), false)
  assert.equal(isWeeklySummaryPage(v, 1, 20), false)
  assert.equal(isWeeklySummaryPage({ ...v, total: 107 }, 2, 20), false)
})
test('weekly Host gets full-set charts/statistics, real pages and snapshot-only search; cost has no day label', () => {
  const s = readFileSync(new URL('../app/pages/weekly-reports.vue', import.meta.url), 'utf8')
  assert.match(s, /useTimeEntryReadPage\(isWeeklySummaryPage/)
  assert.match(s, /useDebouncedSearch/)
  assert.match(s, /search: debounced.value/)
  assert.match(s, /UPagination\s+v-model:page="page"\s+:items-per-page="pageSize"\s+:total="listTotal"/)
  assert.match(s, /共 \{\{ listTotal \}\} 条/)
  assert.match(s, /summaryRead.data.value\?\.summary/)
  assert.doesNotMatch(s, /items.value.reduce|items.value.filter/)
  assert.match(s, /周报部门\/负责人快照、UID/)
  assert.match(s, /formatCost\(overviewStats.cumulativeLaborCost\)/)
  assert.doesNotMatch(s, /cumulativeDays|累计工作量/)
})
