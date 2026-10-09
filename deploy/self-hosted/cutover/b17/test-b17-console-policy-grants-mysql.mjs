// Disposable-MySQL test for b17-console-policy-grants.sql (+ rollback): four audience-bound rows, guards, idempotence, exact rollback.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../../../scripts/test/support/temporary-mysql-harness.mjs'
const here = import.meta.dirname
const schema = readFileSync(resolve(here, '../../../../console/docs/hzy_console_schema.sql'), 'utf8')
const table = name => schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS \`${name}\` \\([\\s\\S]*?\\) ENGINE=[^;]*;`))[0]
const sql = f => readFileSync(resolve(here, f), 'utf8')
const plan = await buildTemporaryMySqlPlan({ rootDir: resolve(here, '../../../..'), mysqld: process.env.MYSQLD || 'mysqld', mysql: process.env.MYSQL || 'mysql' })
await withTemporaryMySql(plan, async (context) => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  try {
    await db.query('SET FOREIGN_KEY_CHECKS=0'); await db.query(table('service_clients')); await db.query(table('service_client_grants')); await db.query(table('service_client_credentials').replace(/CONSTRAINT[^\n]*\n?/g, m => m)).catch(() => {})
    await db.query(`INSERT INTO service_clients(id,client_code,client_name,app_code,status,current_credential_id) VALUES(3,'console.runtime','Console','console','active',NULL),(4,'aims.runtime','Aims','aims','active',1)`)
    const count = async () => (await db.query(`SELECT COUNT(*) n FROM service_client_grants WHERE JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.source'))='s4-b17-console-policy'`))[0][0].n
    await db.query(`INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(3,'console:policy-bundle','read','{"source":"policy-bundle-install"}','active'),(3,'console:policy-bundle','write','{"source":"policy-bundle-install"}','active')`)
    await db.query(sql('b17-console-policy-grants.sql')); assert.equal(await count(), 0, 'guard: no credential -> nothing written')
    await db.query(`UPDATE service_clients SET current_credential_id=1 WHERE id=3`)
    await db.query(sql('b17-console-policy-grants.sql')); assert.equal(await count(), 0, 'guard: enterprise.runtime reference grant missing -> nothing written')
    await db.query(`INSERT INTO service_clients(id,client_code,client_name,app_code,status,current_credential_id) VALUES(5,'enterprise.runtime','Enterprise','enterprise','active',1)`)
    await db.query(`INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(5,'data-runtime:console:policy-bundle','read','{"audience":"data-runtime"}','active')`)
    await db.query(sql('b17-console-policy-grants.sql')); assert.equal(await count(), 4)
    const [rows] = await db.query(`SELECT resource_code, action, status, scope_json FROM service_client_grants WHERE JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.source'))='s4-b17-console-policy' ORDER BY resource_code, action`)
    assert.deepEqual(rows.map(r => `${r.resource_code}/${r.action}`), ['data-runtime:console:policy-bundle/read', 'data-runtime:console:policy-bundle/write', 'tenant-runtime:console:policy-bundle/read', 'tenant-runtime:console:policy-bundle/write'])
    for (const r of rows) {
      const s = typeof r.scope_json === 'string' ? JSON.parse(r.scope_json) : r.scope_json
      assert.equal(r.status, 'active'); assert.equal(s.tenantCode, 'C000001'); assert.equal(s.deploymentCode, 'C000001-console')
      assert.equal(s.semanticScope, `console:policy-bundle:${r.action}`); assert.ok(r.resource_code.startsWith(`${s.audience}:`))
    }
    await db.query(sql('b17-console-policy-grants.sql')); assert.equal(await count(), 4, 'second run: no duplicates')
    const [[old]] = await db.query(`SELECT COUNT(*) n FROM service_client_grants WHERE JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.source'))='policy-bundle-install'`); assert.equal(old.n, 2, 'existing rows untouched')
    await db.query(sql('b17-console-policy-grants.rollback.sql')); assert.equal(await count(), 0)
    const [[kept]] = await db.query('SELECT COUNT(*) n FROM service_client_grants'); assert.equal(kept.n, 3, 'rollback removes only its four rows')
    console.log('b17 console policy grants test: OK (guard, four audience-bound rows, second run no-op, existing rows untouched, rollback exact)')
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
