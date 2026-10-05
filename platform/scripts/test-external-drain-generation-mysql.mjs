import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  try {
    await db.query(`CREATE TABLE enterprise_external_drain_approvals (
      tenant_code VARCHAR(64) NOT NULL, environment VARCHAR(32) NOT NULL, cutover_key VARCHAR(191) NOT NULL,
      seal_revision BIGINT UNSIGNED NOT NULL, seal_payload_sha256 CHAR(64) NOT NULL, request_id VARCHAR(128) NOT NULL,
      payload_sha256 CHAR(64) NOT NULL, payload_json JSON NOT NULL, actor_uid VARCHAR(128) NOT NULL,
      approval_reference VARCHAR(500) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY(tenant_code,environment,cutover_key,seal_revision), UNIQUE KEY uk_external_drain_request(tenant_code,request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    const insert = (revision, generation, request) => db.execute(`INSERT INTO enterprise_external_drain_approvals
      (tenant_code,environment,cutover_key,seal_revision,seal_payload_sha256,request_id,payload_sha256,payload_json,actor_uid,approval_reference)
      VALUES('C000001','prod','cutover-1',?,'${'a'.repeat(64)}',?,'${'b'.repeat(64)}',?,'operator','review')`,
    [revision, request, JSON.stringify({ generation })])
    await insert(1, '7', 'old-request')
    const migration = readFileSync(new URL('../docs/sql/migrations/20260929-enterprise-external-drain-generation.sql', import.meta.url), 'utf8')
    await db.query(migration)
    const [[old]] = await db.query('SELECT target_generation,artifact_json FROM enterprise_external_drain_approvals WHERE request_id=?', ['old-request'])
    assert.equal(old.target_generation, '7')
    assert.equal(old.artifact_json, null, 'old unsigned approval cannot be replayed')
    await assert.rejects(db.execute(`INSERT INTO enterprise_external_drain_approvals
      (tenant_code,environment,cutover_key,target_generation,seal_revision,seal_payload_sha256,request_id,payload_sha256,payload_json,actor_uid,approval_reference)
      VALUES('C000001','prod','cutover-1','7',2,?,'second-request',?,?, 'operator','review')`,
    ['a'.repeat(64), 'b'.repeat(64), JSON.stringify({ generation: '7' })]), /Duplicate entry/)
    const [[keys]] = await db.query(`SELECT COUNT(*) count FROM information_schema.statistics WHERE table_schema=DATABASE()
      AND table_name='enterprise_external_drain_approvals' AND index_name='uk_external_drain_generation'`)
    assert.equal(keys.count, 4)
    console.log('external drain generation migration: backfill PASS, unique generation PASS, unsigned replay denied')
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
