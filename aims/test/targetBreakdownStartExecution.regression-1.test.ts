import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../app/pages/projects/[id]/work-items/[workItemId]/breakdown.vue', import.meta.url),
  'utf8'
)

// Regression: ISSUE-008 — a distributed target could remain in "任务分解" after
// its child tasks entered execution, while the breakdown page exposed no way to
// enter the target execution stage.
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-wiztek-huizhi-yun-2026-08-25.md
test('distributed targets expose an explicit start execution action', () => {
  const startGuard = source.slice(
    source.indexOf('const canStartTargetExecution'),
    source.indexOf('async function startTargetExecution')
  )
  const startAction = source.slice(
    source.indexOf('async function startTargetExecution'),
    source.indexOf('/** 执行中目标是否允许编辑追加任务 */')
  )

  assert.match(startGuard, /item\.status === 'todo'/)
  assert.match(startGuard, /children\.every\(child => child\.status !== 'planning'\)/)
  assert.match(startGuard, /isProjectLeader\.value/)
  assert.match(startAction, /body: \{ status: 'in_progress' \}/)
  assert.match(source, /v-if="canStartTargetExecution"[\s\S]*?label="开始执行"/)
})
