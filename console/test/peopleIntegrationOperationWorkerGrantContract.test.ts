import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const seed = readFileSync(
  new URL('../docs/sql/Console-SQL-Seed-v1.86-people-integration-operation-worker-grant.sql', import.meta.url),
  'utf8'
)
const verify = readFileSync(
  new URL('../docs/sql/Console-SQL-Verify-v1.86-people-integration-operation-worker-grant.sql', import.meta.url),
  'utf8'
)

test('People scheduled operation worker receives only the exact execute runtime grants', () => {
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    const resource = `${audience}:people:integration_operation`
    assert.match(seed, new RegExp(`'${resource.replaceAll('-', '\\-')}'(?: AS [^,]+)?\\s*,\\s*'execute'`))
    assert.match(verify, new RegExp(`'${resource.replaceAll('-', '\\-')}'`))
  }

  assert.match(seed, /'purpose', 'people-integration-operation-worker'/)
  assert.match(seed, /sc\.`app_code` = 'people'/)
  assert.doesNotMatch(seed, /integration_operations.*execute/)
})
