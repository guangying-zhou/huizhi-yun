import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Aims runtime grants cover both supported audiences without embedding credentials', () => {
  const seed = readFileSync(
    new URL('../docs/sql/Console-SQL-Seed-v1.57-aims-runtime-grants.sql', import.meta.url),
    'utf8'
  )
  const verify = readFileSync(
    new URL('../docs/sql/Console-SQL-Verify-v1.57-aims-runtime-grants.sql', import.meta.url),
    'utf8'
  )

  for (const [resourceCode, action] of [
    ['data-runtime:aims', 'read'],
    ['data-runtime:aims', 'write'],
    ['tenant-runtime:aims', 'read'],
    ['tenant-runtime:aims', 'write']
  ]) {
    assert.match(
      seed,
      new RegExp(`'${resourceCode}'[\\s\\S]{0,80}'${action}'`),
      `missing Aims runtime grant ${resourceCode}:${action}`
    )
  }
  assert.match(seed, /sc\.`app_code` = 'aims'/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)
  assert.match(verify, /CONCAT\(g\.`resource_code`, ':', g\.`action`\)/)
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})
