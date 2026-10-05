import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../app/pages/projects/[id]/work-items.vue', import.meta.url),
  'utf8'
)

// Regression: ISSUE-001 — the target board rendered empty columns while its initial requests were still running.
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-wiztek-huizhi-yun-2026-08-25.md
test('target board keeps the loading state until its first board request completes', () => {
  assert.match(source, /const initialLoading = ref\(true\)/)
  assert.match(source, /v-if="initialLoading \|\| workItemStore\.loading"/)
  assert.match(source, /await loadBoard\(\)[\s\S]*?finally \{[\s\S]*?boardMounted\.value = true[\s\S]*?initialLoading\.value = false/)
})

test('initial milestone selection does not start a duplicate board request', () => {
  const milestoneWatcher = source.slice(
    source.indexOf('watch(activeMilestoneId'),
    source.indexOf('// 类型 tab 变化时刷新')
  )

  assert.match(milestoneWatcher, /if \(!boardMounted\.value\) return/)
  assert.match(source, /await Promise\.all\(\[[\s\S]*?projectRequest,[\s\S]*?milestoneStore\.fetchMilestones[\s\S]*?loadVersions\(\)/)
})
