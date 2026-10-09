import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../app/pages/projects/[id]/timesheet.vue', import.meta.url),
  'utf8'
)

// Regression: ISSUE-009 — project timesheet waited for permission loading and
// project loading serially, then its date initialization triggered a duplicate
// entries request before the explicit initial request.
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-wiztek-huizhi-yun-2026-08-25.md
test('project timesheet parallelizes prerequisites and suppresses initial watcher reloads', () => {
  const mounted = source.slice(
    source.indexOf('onMounted(async () =>'),
    source.indexOf('watch([activeView')
  )
  const entriesWatcher = source.slice(
    source.indexOf('watch([activeView'),
    source.indexOf('watch(reviewAnchorDate')
  )

  assert.match(source, /const initialized = ref\(false\)/)
  assert.match(mounted, /await Promise\.all\(\[permissionsRequest, projectRequest\]\)/)
  assert.match(mounted, /initializeDateRangeFromProject\(\)/)
  assert.match(mounted, /await Promise\.all\(\[loadEntries\(\), loadReviewQueue\(\)\]\)/)
  assert.match(mounted, /initialized\.value = true/)
  assert.match(entriesWatcher, /if \(!initialized\.value\) return/)
})
