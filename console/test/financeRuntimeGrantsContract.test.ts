import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Finance runtime grants cover every server-owned data-runtime scope', () => {
  const seed = readFileSync(
    new URL('../docs/sql/Console-SQL-Seed-v1.61-finance-runtime-grants.sql', import.meta.url),
    'utf8'
  )
  const verify = readFileSync(
    new URL('../docs/sql/Console-SQL-Verify-v1.61-finance-runtime-grants.sql', import.meta.url),
    'utf8'
  )
  const runtimeClient = readFileSync(
    new URL('../../finance/server/utils/dataRuntime.ts', import.meta.url),
    'utf8'
  )

  const semanticScopes = new Set(
    [...runtimeClient.matchAll(/'((?:finance\.)[a-z0-9_.]+)'/g)]
      .map(match => match[1])
      .filter(scope => scope.endsWith('.read') || scope === 'finance.write')
  )
  for (const scope of semanticScopes) {
    assert.match(seed, new RegExp(`'${scope.replaceAll('.', '\\.')}'`), `missing Finance runtime scope ${scope}`)
  }

  for (const scope of [
    'finance.read',
    'finance:invoice-request:create',
    'finance:integration_operation:execute',
    'finance.notifications_due.execute'
  ]) {
    assert.match(seed, new RegExp(`'${scope.replaceAll('.', '\\.')}'`), `missing Finance orchestration scope ${scope}`)
  }

  assert.match(seed, /SELECT 'data-runtime' AS `audience`/)
  assert.match(seed, /UNION ALL SELECT 'tenant-runtime'/)
  assert.match(seed, /sc\.`app_code` = 'finance'/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)
  assert.match(verify, /CONCAT\(g\.`resource_code`, ':', g\.`action`\)/)
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})
