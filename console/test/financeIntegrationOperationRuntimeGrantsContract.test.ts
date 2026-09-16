import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const seed = readFileSync('../console/docs/sql/Console-SQL-Seed-v1.65-finance-integration-operation-grants.sql', 'utf8')
const verify = readFileSync('../console/docs/sql/Console-SQL-Verify-v1.65-finance-integration-operation-grants.sql', 'utf8')
const integrationAdmin = readFileSync('../finance/server/utils/integrationOperationAdmin.ts', 'utf8')

test('Finance integration-operation administration receives exact runtime grants', () => {
  assert.match(integrationAdmin, /finance:integration_operations:\$\{action\}/)
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    for (const action of ['view', 'replay']) {
      assert.match(seed, new RegExp(`${audience}:finance:integration_operations'(?: AS [^,]+)?\\s*,\\s*'${action}'`))
    }
  }
  assert.match(seed, /sc\.`app_code` = 'finance'/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)
  assert.match(verify, /HAVING COUNT\(\*\) = 4/)
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})
