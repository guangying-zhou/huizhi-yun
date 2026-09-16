import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const seed = readFileSync('../console/docs/sql/Console-SQL-Seed-v1.66-aims-altoc-integration-operation-grants.sql', 'utf8')
const verify = readFileSync('../console/docs/sql/Console-SQL-Verify-v1.66-aims-altoc-integration-operation-grants.sql', 'utf8')
const aimsAdmin = readFileSync('../aims/server/utils/integrationOperationAdmin.ts', 'utf8')
const altocAdmin = readFileSync('../altoc/server/utils/integrationOperationAdmin.ts', 'utf8')

test('Aims and Altoc integration-operation administration receive exact runtime grants', () => {
  for (const [app, admin] of [['aims', aimsAdmin], ['altoc', altocAdmin]] as const) {
    assert.ok(admin.includes(`${app}:integration_operations:`))
    assert.match(admin, /integration_operations:\$\{action\}/)
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      for (const action of ['view', 'replay']) {
        assert.match(seed, new RegExp(`${audience}:${app}:integration_operations'(?: AS [^,]+)?\\s*,\\s*'${action}'`))
      }
    }
  }

  assert.match(seed, /grants\.`app_code` = sc\.`app_code`/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)
  assert.match(verify, /HAVING COUNT\(\*\) = 4/)
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})
