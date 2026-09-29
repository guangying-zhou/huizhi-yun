import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const seed = await readFile(new URL('../docs/sql/Console-SQL-Seed-v2.31-aims-unified-scheduler-grants.sql', import.meta.url), 'utf8')
const verify = await readFile(new URL('../docs/sql/Console-SQL-Verify-v2.31-aims-unified-scheduler-grants.sql', import.meta.url), 'utf8')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  try {
    await db.query(`CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(100),app_code VARCHAR(50),status VARCHAR(20),current_credential_id BIGINT);
      CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,status VARCHAR(20));
      CREATE TABLE service_client_grants(id BIGINT AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(200),action VARCHAR(50),scope_json JSON,status VARCHAR(20),created_at DATETIME,updated_at DATETIME,UNIQUE KEY(service_client_id,resource_code,action));
      INSERT INTO service_clients VALUES(1,'aims.runtime','aims','active',1),(2,'other.runtime','aims','active',2);
      INSERT INTO service_client_credentials VALUES(1,'active'),(2,'active');`)
    const apply = async () => (await db.query(seed))[0].filter(row => typeof row?.affectedRows === 'number').reduce((n, row) => n + row.affectedRows, 0)
    const check = async () => (await db.query(verify))[0].flat().filter(row => Object.hasOwn(row || {}, 'exact_rows'))
    assert.equal(await apply(), 6)
    assert.equal(await apply(), 0)
    const rows = await check()
    assert.equal(rows.length, 6)
    for (const row of rows) { assert.equal(Number(row.exact_rows), 1); assert.equal(Number(row.active_exact_rows), 1) }
    const [[other]] = await db.query('SELECT COUNT(*) AS n FROM service_client_grants WHERE service_client_id=2')
    assert.equal(Number(other.n), 0)
    const [[target]] = await db.query("SELECT id FROM service_client_grants WHERE resource_code='data-runtime:aims:integration_operation'")
    await db.query("UPDATE service_client_grants SET scope_json=JSON_REMOVE(scope_json,'$.tenantCode','$.deploymentCode') WHERE id=?", [target.id])
    assert.equal(await apply(), 0, 'old physical row is not silently repaired')
    const missingBinding = (await check()).find(row => row.audience === 'data-runtime' && row.resource_code === 'integration_operation')
    assert.equal(Number(missingBinding.exact_rows), 1)
    assert.equal(Number(missingBinding.active_exact_rows), 0)
    assert.equal(Number(missingBinding.active_binding_only_missing_rows), 1)
    assert.equal(Number(missingBinding.revoked_rows), 0)
    await db.query("UPDATE service_client_grants SET status='revoked' WHERE id=?", [target.id])
    assert.equal(await apply(), 0, 'revoked physical grant must remain revoked')
    const revoked = (await check()).find(row => row.audience === 'data-runtime' && row.resource_code === 'integration_operation')
    assert.equal(Number(revoked.active_exact_rows), 0)
    assert.equal(Number(revoked.active_binding_only_missing_rows), 0)
    assert.equal(Number(revoked.revoked_rows), 1)
    console.log(JSON.stringify({ fixture: '/tmp disposable MySQL', inserted: 6, rerun: 0, fullyBound: 'PASS', bindingOnlyVsRevoked: 'PASS', revokedUnchanged: 'PASS' }))
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
