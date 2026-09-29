import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const seed = await readFile(new URL('../docs/sql/Console-SQL-Seed-v2.23-enterprise-project-document-accessible.sql', import.meta.url), 'utf8')
const verify = await readFile(new URL('../docs/sql/Console-SQL-Verify-v2.23-enterprise-project-document-accessible.sql', import.meta.url), 'utf8')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  try {
    await db.query(`CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(100),app_code VARCHAR(50),status VARCHAR(20),current_credential_id BIGINT);
      CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,status VARCHAR(20));
      CREATE TABLE service_client_grants(id BIGINT AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(200),action VARCHAR(50),scope_json JSON,status VARCHAR(20),created_at DATETIME,updated_at DATETIME,UNIQUE KEY(service_client_id,resource_code,action));
      INSERT INTO service_clients VALUES(1,'enterprise.runtime','enterprise','active',1);
      INSERT INTO service_client_credentials VALUES(1,'active');
      INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(1,'aims:project-documents','read',JSON_OBJECT('audience','aims','fixture','unchanged'),'active');`)
    const apply = async () => {
      const [results] = await db.query(seed)
      return results.filter(row => typeof row?.affectedRows === 'number').reduce((n, row) => n + row.affectedRows, 0)
    }
    const check = async () => (await db.query(verify))[0].flat().find(row => Object.hasOwn(row || {}, 'exact_rows'))
    const [before] = await db.query('SELECT * FROM service_client_grants WHERE id=1')
    assert.equal(await apply(), 1)
    assert.equal(await apply(), 0)
    const result = await check()
    assert.equal(Number(result.exact_rows), 1)
    assert.equal(Number(result.active_exact_rows), 1)
    assert.equal(result.client_status, 'active')
    assert.equal(result.credential_status, 'active')
    assert.deepEqual((await db.query('SELECT * FROM service_client_grants WHERE id=1'))[0], before)
    for (const field of ['audience', 'tenantCode', 'deploymentCode', 'semanticScope', 'source']) {
      const [[row]] = await db.query('SELECT scope_json FROM service_client_grants WHERE id=2')
      await db.query('UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,?,NULL) WHERE id=2', ['$.' + field])
      assert.equal(Number((await check()).active_exact_rows), 0, field)
      await db.query('UPDATE service_client_grants SET scope_json=? WHERE id=2', [JSON.stringify(row.scope_json)])
    }
    await db.query('UPDATE service_client_grants SET status=\'revoked\' WHERE id=2')
    assert.equal(await apply(), 0)
    assert.equal(Number((await check()).active_exact_rows), 0)
    await db.query('DELETE FROM service_client_grants WHERE id=2')
    for (const target of ['service_clients', 'service_client_credentials']) {
      await db.query(`UPDATE ${target} SET status='inactive' WHERE id=1`)
      assert.equal(await apply(), 0)
      await db.query(`UPDATE ${target} SET status='active' WHERE id=1`)
    }
    console.log(JSON.stringify({ fixture: '/tmp disposable MySQL', insert: 'PASS', rerun: 'PASS', nullBindingsRejected: 'PASS', revokedUnchanged: 'PASS', inactiveIdentityRejected: 'PASS', unrelatedRowsUnchanged: 'PASS' }))
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
