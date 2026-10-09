import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const seed = readFileSync(new URL('../docs/sql/Console-SQL-Seed-v2.5-aims-milestone-receivable-coordinator-grants.sql', import.meta.url), 'utf8')
const verify = readFileSync(new URL('../docs/sql/Console-SQL-Verify-v2.5-aims-milestone-receivable-coordinator-grants.sql', import.meta.url), 'utf8')

test('AA-04 coordinator prepares both Runtime audiences and only the fixed Altoc capability', () => {
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    assert.match(seed, new RegExp(`'${audience}:aims'[\\s\\S]{0,100}'write'`))
    assert.match(verify, new RegExp(`'${audience}:aims'`))
  }
  assert.match(seed, /'altoc:receivable'[\s\S]{0,100}'mark-billable'/)
  assert.match(seed, /aims-milestone-receivable-coordinator/)
  assert.match(seed, /INSERT INTO `service_client_grants`/)
  assert.match(seed, /AND NOT EXISTS \([\s\S]*existing\.`service_client_id` = sc\.`id`/)
  assert.doesNotMatch(seed, /INSERT IGNORE|ON DUPLICATE KEY UPDATE|VALUES\(`scope_json`\)/)
  assert.match(verify, /'MISSING'/)
  assert.match(verify, /'NOT_ACTIVE'/)
  assert.match(verify, /'ACTIVE'/)
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})
