import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const route = readFileSync(
  new URL('../server/api/admin/performance-cycles/[code]/collect.post.ts', import.meta.url),
  'utf8'
)

describe('People Aims contribution snapshot collection', () => {
  test('always submits an explicitly complete scoped replacement, including empty snapshots', () => {
    assert.match(route, /project_code: projectCode/)
    assert.match(route, /period_start: periodStart/)
    assert.match(route, /period_end: periodEnd/)
    assert.match(route, /source_biz_type: 'time_entries'/)
    assert.match(route, /review_status \|\| entry\.reviewStatus\) === 'approved'/)
    assert.match(route, /score_status: 'unscored'/)
    assert.doesNotMatch(route, /defaultContributionScore/)
    assert.match(route, /sync_mode: 'replace_scope'/)
    assert.match(route, /snapshot_complete: true/)
    assert.doesNotMatch(route, /if \(items\.length === 0\)/)
  })

  test('rejects incomplete or malformed Aims time-entry snapshots before replacement', () => {
    assert.match(route, /page\.total !== items\.length/)
    assert.match(route, /page\.page !== 1/)
    assert.match(route, /entryProjectCode !== projectCode/)
    assert.match(route, /!Number\.isFinite\(hours\) \|\| hours < 0/)
  })
})
