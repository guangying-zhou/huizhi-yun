import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const seed = readFileSync(
  new URL('../docs/sql/Console-SQL-Seed-v1.94-aims-gitlab-issues-and-task-feed.sql', import.meta.url),
  'utf8'
)
const verify = readFileSync(
  new URL('../docs/sql/Console-SQL-Verify-v1.94-aims-gitlab-issues-and-task-feed.sql', import.meta.url),
  'utf8'
)

describe('Aims GitLab Issue and external task feed grants', () => {
  test('grants Aims only the fixed GitLab Issue upsert operation', () => {
    assert.match(seed, /'gitlab\.issue-upsert'/)
    assert.match(seed, /sc\.`app_code` = 'aims'/)
    assert.match(verify, /JSON_QUOTE\('gitlab\.issue-upsert'\)/)
  })

  test('uses an exact task-read capability for enrolled external consumers', () => {
    assert.match(seed, /'aims:tasks'\s*,\s*'read'/)
    assert.match(seed, /'semanticScope', 'aims:tasks:read'/)
    assert.match(seed, /'\/api\/v1\/service\/tasks'/)
    assert.match(seed, /'webdev', 'orca'/)
    assert.match(verify, /'aims:tasks'/)
  })
})
