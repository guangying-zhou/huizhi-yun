import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../app/components/WorkflowPanel.vue', import.meta.url),
  'utf8'
)

// Regression: ISSUE-004 — a completed business showed its approved workflow as "not submitted".
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-wiztek-huizhi-yun-2026-08-25.md
test('terminal workflow remains visible when the business cannot submit again', () => {
  const launchStart = source.indexOf('} else if (props.launchPayload) {')
  const submitStart = source.indexOf('async function handleLaunchSubmit()', launchStart)
  const launchLoading = source.slice(launchStart, submitStart)

  assert.notEqual(launchStart, -1)
  assert.match(
    launchLoading,
    /data\.status === 'approved'[\s\S]*?data\.status === 'cancelled'[\s\S]*?&& props\.canSubmit !== false/
  )
  assert.match(launchLoading, /status\.value = data\.status/)
  assert.match(source, /<WorkflowBadge v-if="status" :status="status" \/>/)
})
