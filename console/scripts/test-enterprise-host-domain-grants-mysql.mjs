import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const seed = await readFile(new URL('../docs/sql/Console-SQL-Seed-v2.27-enterprise-host-domain-grants.sql', import.meta.url), 'utf8')
const verify = await readFile(new URL('../docs/sql/Console-SQL-Verify-v2.27-enterprise-host-domain-grants.sql', import.meta.url), 'utf8')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  try {
    await db.query(`CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(100),app_code VARCHAR(50),status VARCHAR(20),current_credential_id BIGINT);
      CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,status VARCHAR(20));
      CREATE TABLE service_client_grants(id BIGINT AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(200),action VARCHAR(50),scope_json JSON,status VARCHAR(20),created_at DATETIME,updated_at DATETIME,UNIQUE KEY(service_client_id,resource_code,action));
      INSERT INTO service_clients VALUES(1,'enterprise.runtime','enterprise','active',1);
      INSERT INTO service_client_credentials VALUES(1,'active');`)
    const apply = async () => (await db.query(seed))[0].filter(row => typeof row?.affectedRows === 'number').reduce((n, row) => n + row.affectedRows, 0)
    const check = async () => (await db.query(verify))[0].flat().filter(row => Object.hasOwn(row || {}, 'exact_rows'))
    assert.equal(await apply(), 5)
    assert.equal(await apply(), 0)
    for (const row of await check()) { assert.equal(Number(row.exact_rows), 1); assert.equal(Number(row.active_exact_rows), 1) }
    assert.equal((await check()).length, 5)
    const [[otherAudience]] = await db.query("SELECT COUNT(*) AS n FROM service_client_grants WHERE resource_code LIKE 'tenant-runtime:%:enterprise-host'")
    assert.equal(Number(otherAudience.n), 0)
    const [[target]] = await db.query("SELECT id FROM service_client_grants WHERE resource_code='data-runtime:aims:enterprise-host'")
    for (const field of ['audience', 'tenantCode', 'deploymentCode', 'semanticScope', 'source', 'purpose']) {
      const [[old]] = await db.query('SELECT scope_json FROM service_client_grants WHERE id=?', [target.id])
      await db.query('UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,?,NULL) WHERE id=?', ['$.' + field, target.id])
      assert.equal(Number((await check()).find(row => row.domain === 'aims' && row.audience === 'data-runtime').active_exact_rows), 0, field)
      await db.query('UPDATE service_client_grants SET scope_json=? WHERE id=?', [JSON.stringify(old.scope_json), target.id])
    }
    await db.query("UPDATE service_client_grants SET status='revoked' WHERE id=?", [target.id])
    assert.equal(await apply(), 0)
    assert.equal(Number((await check()).find(row => row.domain === 'aims' && row.audience === 'data-runtime').active_exact_rows), 0)
    console.log(JSON.stringify({ fixture: '/tmp disposable MySQL', insert: 'PASS', rerun: 'PASS', binding: 'PASS', revokedUnchanged: 'PASS' }))
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
