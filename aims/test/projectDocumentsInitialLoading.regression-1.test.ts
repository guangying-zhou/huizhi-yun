import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../app/pages/projects/[id]/documents.vue', import.meta.url),
  'utf8'
)

// Regression: ISSUE-010 — project documents waited for project, milestones and
// documents sequentially, leaving the document counters at zero for about 30s.
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-wiztek-huizhi-yun-2026-08-25.md
test('project documents load independent prerequisites concurrently', () => {
  const mounted = source.slice(source.indexOf('onMounted(async () =>'))

  assert.match(mounted, /const projectRequest =/)
  assert.match(mounted, /await Promise\.all\(\[/)
  assert.match(mounted, /projectRequest,/)
  assert.match(mounted, /milestoneStore\.fetchMilestones\(projectId\.value\),/)
  assert.match(mounted, /loadDocuments\(\)/)
  assert.doesNotMatch(mounted, /await milestoneStore\.fetchMilestones/)
})
