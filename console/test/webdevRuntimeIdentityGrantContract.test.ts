import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const seed = readFileSync(
  new URL('../docs/sql/Console-SQL-Seed-v2.0-webdev-runtime-identity.sql', import.meta.url),
  'utf8'
)
const verify = readFileSync(
  new URL('../docs/sql/Console-SQL-Verify-v2.0-webdev-runtime-identity.sql', import.meta.url),
  'utf8'
)

test('WebDev runtime seed provisions a secret-free runtime identity placeholder', () => {
  assert.match(seed, /'webdev\.runtime',[\s\S]*'WebDev Runtime',[\s\S]*'webdev'/)
  assert.match(seed, /'svc\.webdev\.runtime\.client_secret'/)
  assert.match(seed, /'HZY_SERVICE_CLIENT_WEBDEV_SECRET'/)
  assert.match(seed, /'sha256_runtime_identity_placeholder_webdev'/)
  assert.match(seed, /'env_ref'/)
  assert.match(seed, /'external_ref'/)
  assert.doesNotMatch(seed, /`ciphertext_blob`/)
})

test('WebDev runtime seed and verify cover both runtime audiences with exact read/write grants', () => {
  for (const file of [seed, verify]) {
    assert.match(file, /'data-runtime:webdev'/)
    assert.match(file, /'tenant-runtime:webdev'/)
    assert.match(file, /`action` = 'read'|AS `action`, 'read'/)
    assert.match(file, /`action` = 'write'|'write', 'webdev\.write'/)
  }
  assert.match(seed, /'semanticScope', grant_scope\.`semantic_scope`/)
  assert.match(seed, /'purpose', 'webdev-tenant-runtime'/)
})
