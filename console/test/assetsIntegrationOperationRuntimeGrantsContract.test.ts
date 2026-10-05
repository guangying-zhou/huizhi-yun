import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Assets integration-operation administration receives exact runtime grants', () => {
  const seed = readFileSync(
    new URL('../docs/sql/Console-SQL-Seed-v1.63-assets-integration-operation-grants.sql', import.meta.url),
    'utf8'
  )
  const verify = readFileSync(
    new URL('../docs/sql/Console-SQL-Verify-v1.63-assets-integration-operation-grants.sql', import.meta.url),
    'utf8'
  )
  const admin = readFileSync(
    new URL('../../assets/server/utils/integrationOperationAdmin.ts', import.meta.url),
    'utf8'
  )

  assert.match(admin, /assets:integration_operations:\$\{action\}/)
  assert.match(seed, /'data-runtime:assets:integration_operations' AS `resource_code`, 'view' AS `action`/)
  assert.match(seed, /'data-runtime:assets:integration_operations', 'replay'/)
  assert.match(seed, /'tenant-runtime:assets:integration_operations', 'view'/)
  assert.match(seed, /'tenant-runtime:assets:integration_operations', 'replay'/)
  assert.match(seed, /sc\.`app_code` = 'assets'/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)
  assert.match(verify, /CONCAT\(g\.`resource_code`, ':', g\.`action`\)/)
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})
