import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../app/pages/projects/[id]/board.vue', import.meta.url),
  'utf8'
)

// Regression: ISSUE-005 — returning from task execution left the board on the task's old status.
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-wiztek-huizhi-yun-2026-08-25.md
test('task board reloads after its nested execution route closes', () => {
  const watcherStart = source.indexOf('watch(childRouteActive')
  const detailStart = source.indexOf('async function openDetail', watcherStart)
  const watcher = source.slice(watcherStart, detailStart)

  assert.notEqual(watcherStart, -1)
  assert.match(watcher, /wasActive && !active && boardMounted\.value/)
  assert.match(watcher, /await loadBoard\(\)/)
})
