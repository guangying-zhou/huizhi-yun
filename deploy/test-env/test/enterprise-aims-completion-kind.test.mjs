import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../../scripts/test/support/temporary-mysql-harness.mjs'
import { applyAimsCompletionKind, planAimsCompletionKind } from '../enterprise-aims-completion-kind.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const verify = (path, socketPath, shouldPass) => {
  if (shouldPass) {
    execFileSync('go', ['run', './cmd/hzy-enterprise-verify-views', '--config', path, '--socket', socketPath],
      { cwd: resolve(rootDir, 'data-runtime'), stdio: 'pipe' })
    return
  }
  assert.throws(() => execFileSync('go', ['run', './cmd/hzy-enterprise-verify-views', '--config', path, '--socket', socketPath],
    { cwd: resolve(rootDir, 'data-runtime'), stdio: 'pipe' }))
}
await withTemporaryMySql(plan, async context => {
  const root = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', dateStrings: true })
  const name = `hzy_completion_${randomUUID().replaceAll('-', '')}`
  await root.query(`CREATE DATABASE \`${name}\``)
  const db = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', database: name, dateStrings: true })
  const privateDir = await mkdtemp(join(tmpdir(), 'hzy-completion-kind-'))
  const configPath = join(privateDir, 'config.json')
  try {
    await db.query(`CREATE TABLE aims_work_item_completion_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,project_id BIGINT UNSIGNED NOT NULL,
      work_item_id BIGINT UNSIGNED NOT NULL,requested_by VARCHAR(64) NOT NULL,
      snapshot_json JSON NOT NULL,snapshot_sha256 CHAR(64) NOT NULL,review_version CHAR(64) NOT NULL,
      status ENUM('queued','running','approved','rejected','cancelled') NOT NULL,
      workflow_instance_id BIGINT UNSIGNED NULL,workflow_instance_no VARCHAR(64) NULL,
      target_receipt_id VARCHAR(64) NULL,operation_key VARCHAR(191) NOT NULL,
      active_work_item_id BIGINT UNSIGNED GENERATED ALWAYS AS
        (CASE WHEN status IN ('queued','running') THEN work_item_id ELSE NULL END) STORED,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY uk_completion_operation(operation_key)) ENGINE=InnoDB`)
    await db.query(`CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(100),
      environment_code VARCHAR(100),runtime_deployment VARCHAR(100),schema_version VARCHAR(100),generation BIGINT) ENGINE=InnoDB`)
    await db.query("INSERT INTO enterprise_schema_registry VALUES(1,'C000001','isolated','isolated-runtime','v1',1)")
    const [[{ instance }]] = await db.query('SELECT @@server_uuid AS instance')
    await writeFile(configPath, JSON.stringify({ tenant: 'C000001', deployment: 'isolated-runtime',
      deploymentBindings: { aims: 'isolated-aims' }, enterprise: { enabled: true, environment: 'isolated', schemaVersion: 'v1',
        generation: 1, instanceId: instance, db: { host: '127.0.0.1', port: context.port, user: 'root', database: name,
          connectionLimit: 2 }, domains: { aims: { ownerDeployment: 'isolated-aims', read: 'unified', write: 'unified',
            scheduler: 'disabled', tables: { work_item_completion_requests: 'aims_work_item_completion_requests' } } } } }),
    { mode: 0o600 })
    const [physical] = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME='aims_work_item_completion_requests' ORDER BY ORDINAL_POSITION`, [name])
    const makeView = columns => `CREATE OR REPLACE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW \`${name}\`.\`work_item_completion_requests\` AS SELECT ${columns.map(({ COLUMN_NAME }) => `\`${name}\`.\`aims_work_item_completion_requests\`.\`${COLUMN_NAME}\` AS \`${COLUMN_NAME}\``).join(',')} FROM \`${name}\`.\`aims_work_item_completion_requests\``
    await db.query(makeView(physical))
    await db.execute(`INSERT INTO aims_work_item_completion_requests
      (project_id,work_item_id,requested_by,snapshot_json,snapshot_sha256,review_version,status,operation_key)
      VALUES(?,?,?,?,?,?,?,?)`, [1, 2, 'owner', JSON.stringify({ item: { id: 2 }, children: [{ id: 3 }] }),
      'a'.repeat(64), 'b'.repeat(64), 'approved', 'target-old-key'])
    const before = await planAimsCompletionKind(db)
    assert.equal(before.column, 'missing')
    assert.equal(before.rowCount, 1)
    verify(configPath, context.socketPath, true)
    await assert.rejects(applyAimsCompletionKind(db, '0'.repeat(64)), /plan changed/)
    const after = await applyAimsCompletionKind(db, digest(before))
    assert.equal(after.column, 'installed')
    assert.equal(after.targetRows, 1)
    assert.equal(after.legacyRowsHash, before.legacyRowsHash)
    assert.equal(after.compatibilityView, 'current')
    verify(configPath, context.socketPath, true)
    await db.query(makeView(physical))
    verify(configPath, context.socketPath, false)
    const interrupted = await planAimsCompletionKind(db)
    assert.equal(interrupted.compatibilityView, 'legacy')
    await applyAimsCompletionKind(db, digest(interrupted))
    verify(configPath, context.socketPath, true)
    const [[row]] = await db.query('SELECT kind,snapshot_sha256,review_version,operation_key FROM aims_work_item_completion_requests WHERE id=1')
    assert.deepEqual(row, { kind: 'target', snapshot_sha256: 'a'.repeat(64), review_version: 'b'.repeat(64), operation_key: 'target-old-key' })
    const repeated = await applyAimsCompletionKind(db, digest(after))
    assert.equal(repeated.legacyRowsHash, before.legacyRowsHash)
    await db.execute(`INSERT INTO aims_work_item_completion_requests
      (project_id,work_item_id,kind,requested_by,snapshot_json,snapshot_sha256,review_version,status,operation_key)
      VALUES(?,?,?,?,?,?,?,?,?)`, [1, 4, 'matter', 'owner', '{}', 'c'.repeat(64), 'd'.repeat(64), 'queued', 'matter-new-key'])
    const mixed = await planAimsCompletionKind(db)
    assert.equal(mixed.targetRows, 1)
    assert.equal(mixed.matterRows, 1)
    await assert.rejects(db.query("UPDATE aims_work_item_completion_requests SET kind='unknown' WHERE id=1"),
      error => error.code === 'WARN_DATA_TRUNCATED' || error.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD')
    console.log('PASS isolated MySQL completion kind: Runtime view verification detects drift and repair, row hash unchanged, repeatable')
  } finally {
    await rm(privateDir, { recursive: true, force: true })
    await db.end()
    await root.query(`DROP DATABASE \`${name}\``)
    await root.end()
  }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
