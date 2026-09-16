import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../app/pages/projects/[id]/plan.vue', import.meta.url),
  'utf8'
)

// Regression: ISSUE-013 — project plan waited for the project, template and
// milestones sequentially, showing a false empty state for about 14 seconds.
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-wiztek-huizhi-yun-2026-08-25.md
test('project plan starts milestone loading before awaiting project prerequisites', () => {
  const mounted = source.slice(source.indexOf('onMounted(async () =>'))
  const milestonesStart = mounted.indexOf('const milestonesRequest = milestoneStore.fetchMilestones(projectId.value)')
  const projectAwait = mounted.indexOf('await projectRequest')

  assert.ok(milestonesStart >= 0)
  assert.ok(projectAwait > milestonesStart)
  assert.match(mounted, /const templateRequest = loadProjectTemplateVersion\(\)/)
  assert.match(mounted, /await Promise\.all\(\[\s*templateRequest,\s*Promise\.all\(milestoneStore\.milestones\.map/)
  assert.doesNotMatch(mounted, /await loadProjectTemplateVersion\(\)[\s\S]*?await milestoneStore\.fetchMilestones/)
})
