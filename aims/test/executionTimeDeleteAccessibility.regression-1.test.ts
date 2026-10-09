import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../app/pages/projects/[id]/board/[workItemId]/execution.vue', import.meta.url),
  'utf8'
)

// Regression: ISSUE-003 — the destructive time-entry action had no accessible name.
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-wiztek-huizhi-yun-2026-08-25.md
test('time entry delete action identifies itself before activation', () => {
  const deleteButtonStart = source.indexOf('icon="i-lucide-trash-2"')
  const deleteButtonEnd = source.indexOf('/>', deleteButtonStart)
  const deleteButton = source.slice(deleteButtonStart, deleteButtonEnd)

  assert.notEqual(deleteButtonStart, -1)
  assert.match(deleteButton, /aria-label="删除工时记录"/)
  assert.match(deleteButton, /title="删除工时记录"/)
  assert.match(deleteButton, /@click\.stop="deleteTimeEntry\(entry\.id\)"/)
})
