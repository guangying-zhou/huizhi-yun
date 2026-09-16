import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('directory management list pagination', () => {
  test('users and projects perform a filtered count before bounded page reads', () => {
    const repository = source('server/utils/directoryRuntime.ts')
    const runtime = readFileSync(
      new URL('../../data-runtime/internal/apps/directory/console_management.go', import.meta.url),
      'utf8'
    )

    assert.match(repository, /getConsoleDirectoryUsers\(requestEvent\(\), query\)/)
    assert.match(repository, /getConsoleDirectoryProjects\(requestEvent\(\), query\)/)
    assert.doesNotMatch(repository, /queryRows|queryRow|server\/utils\/db/)
    assert.match(runtime, /SELECT COUNT\(\*\) FROM directory_users u/)
    assert.match(runtime, /SELECT COUNT\(\*\) FROM directory_projects/)
    assert.match(runtime, /ORDER BY u\.uid ASC LIMIT \? OFFSET \?/)
    assert.match(runtime, /ORDER BY created_at ASC,id ASC LIMIT \? OFFSET \?/)
    assert.match(runtime, /pageSize > 100/)
  })

  test('management pages send pagination, reset filters, and render totals', () => {
    for (const pagePath of ['app/pages/directory/users.vue', 'app/pages/directory/projects.vue']) {
      const page = source(pagePath)

      assert.match(page, /page: page\.value/)
      assert.match(page, /pageSize/)
      assert.match(page, /v-model:page="page"/)
      assert.match(page, /:total="total"/)
      assert.match(page, /function resetFilters\(\)/)
      assert.match(page, /@keyup\.enter="flushSearch"/)
      assert.match(page, /usePageActions\(\)/)
      assert.match(page, /<CommonEmptyState/)
    }
  })
})
