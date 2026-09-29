import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const docs = resolve(rootDir, 'assets/docs')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async ({ socketPath }) => {
  const mysql = (sql, { db = 'drift_test', allowFail = false } = {}) => {
    const result = spawnSync('/usr/local/mysql/bin/mysql', ['-uroot', `--socket=${socketPath}`, '--batch', '--skip-column-names', ...(db ? [db] : [])], { input: sql, encoding: 'utf8' })
    if (!allowFail) assert.equal(result.status, 0, result.stderr)
    return result
  }
  const file = name => readFileSync(resolve(docs, 'migrations', name), 'utf8')
  // Canonical schema without its database statements, then reproduce the drifted (older) shape.
  const schema = readFileSync(resolve(docs, 'assets_schema.sql'), 'utf8').split('\n').filter(line => !/^\s*(CREATE\s+DATABASE|USE)\b/i.test(line)).join('\n')
  mysql('DROP DATABASE IF EXISTS drift_test; CREATE DATABASE drift_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', { db: '' })
  mysql(schema)
  const columns = () => mysql("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT,'NULL'), COLUMN_COMMENT, ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='drift_test' AND ((TABLE_NAME='asset_physical_details' AND COLUMN_NAME='config_detail') OR (TABLE_NAME='asset_documents' AND COLUMN_NAME IN ('artifact_type','source_context'))) ORDER BY 1,2").stdout
  const canonical = columns()
  assert.equal(canonical.trim().split('\n').length, 3)
  mysql('ALTER TABLE asset_documents DROP COLUMN source_context, DROP COLUMN artifact_type; ALTER TABLE asset_physical_details DROP COLUMN config_detail')
  assert.equal(columns().trim(), '')
  assert.match(mysql(file('20260929_backfill_schema_drift_verify.sql')).stdout, /FAIL/)
  // Apply: definitions (type, default, comment, position) must equal the canonical schema.
  mysql(file('20260929_backfill_schema_drift.sql'))
  assert.equal(columns(), canonical)
  assert.equal(mysql(file('20260929_backfill_schema_drift_verify.sql')).stdout.trim(), 'PASS\nPASS\nPASS')
  // A second run stops at the guard and changes nothing.
  const again = mysql(file('20260929_backfill_schema_drift.sql'), { allowFail: true })
  assert.notEqual(again.status, 0)
  assert.match(again.stderr, /hzy_schema_drift_columns_already_exist/)
  assert.equal(columns(), canonical)
  // Rollback is refused once a column holds data, allowed while unused.
  mysql("INSERT INTO asset_documents (object_type, object_id, document_id, document_type, artifact_type) VALUES ('asset', 1, 'doc-1', 'other', 'solution')")
  const refused = mysql(file('20260929_backfill_schema_drift_rollback.sql'), { allowFail: true })
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /hzy_schema_drift_columns_in_use/)
  assert.equal(columns(), canonical)
  mysql('DELETE FROM asset_documents')
  mysql(file('20260929_backfill_schema_drift_rollback.sql'))
  assert.equal(columns().trim(), '')
  mysql('DROP DATABASE drift_test', { db: '' })
  console.log('assets schema drift migration: apply, verify, guard, rollback OK')
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
