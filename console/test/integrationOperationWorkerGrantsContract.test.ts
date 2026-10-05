import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const seed = readFileSync(
  new URL('../docs/sql/Console-SQL-Seed-v1.92-integration-operation-worker-grants.sql', import.meta.url),
  'utf8'
)
const verify = readFileSync(
  new URL('../docs/sql/Console-SQL-Verify-v1.92-integration-operation-worker-grants.sql', import.meta.url),
  'utf8'
)

const workerSources = new Map([
  [
    'aims',
    readFileSync(new URL('../../aims/server/utils/integrationOperationDrain.ts', import.meta.url), 'utf8')
  ],
  [
    'altoc',
    readFileSync(new URL('../../altoc/server/utils/integrationOperationDrain.ts', import.meta.url), 'utf8')
  ],
  [
    'assets',
    readFileSync(new URL('../../assets/server/utils/deliveryAssetStatusOperation.ts', import.meta.url), 'utf8')
  ]
])

test('scheduled integration-operation workers receive exact execute grants for both runtime audiences', () => {
  for (const [appCode, workerSource] of workerSources) {
    assert.match(workerSource, new RegExp(`${appCode}\\.write ${appCode}:integration_operation:execute`))

    for (const audience of ['data-runtime', 'tenant-runtime']) {
      const resource = `${audience}:${appCode}:integration_operation`
      const resourcePattern = resource.replaceAll('-', '\\-')
      assert.match(seed, new RegExp(`'${resourcePattern}'(?: AS [^,]+)?\\s*,\\s*'execute'`))
      assert.match(verify, new RegExp(`'${resourcePattern}'`))
    }
  }

  assert.match(seed, /'purpose', CONCAT\(grants\.`app_code`, '-integration-operation-worker'\)/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)
  assert.match(verify, /HAVING COUNT\(\*\) = 2/)
  assert.doesNotMatch(`${seed}\n${verify}`, /integration_operations.*execute/)
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})
