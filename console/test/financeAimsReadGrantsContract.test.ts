import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Finance project accounting receives only Aims read service grants', () => {
  const seed = readFileSync(
    new URL('../docs/sql/Console-SQL-Seed-v1.62-finance-aims-read-grants.sql', import.meta.url),
    'utf8'
  )
  const verify = readFileSync(
    new URL('../docs/sql/Console-SQL-Verify-v1.62-finance-aims-read-grants.sql', import.meta.url),
    'utf8'
  )
  const projectAccountingRoute = readFileSync(
    new URL('../../finance/server/api/v1/finance/project-accounting/aims-projects.get.ts', import.meta.url),
    'utf8'
  )

  assert.match(projectAccountingRoute, /appCode: 'aims'/)
  assert.match(projectAccountingRoute, /scope: 'aims\.read'/)
  assert.match(seed, /'data-runtime:aims'/)
  assert.match(seed, /'tenant-runtime:aims'/)
  assert.match(seed, /'semanticScope', 'aims\.read'/)
  assert.match(seed, /sc\.`app_code` = 'finance'/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)
  assert.doesNotMatch(seed, /'write'/)
  assert.match(verify, /CONCAT\(g\.`resource_code`, ':', g\.`action`\)/)
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})
