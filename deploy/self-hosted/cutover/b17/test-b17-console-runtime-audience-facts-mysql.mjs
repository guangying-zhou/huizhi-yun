// Disposable-MySQL test for b17-console-runtime-audience-facts.sql (+ rollback): guard, exact 86-row update, untouched rows, idempotence, exact rollback.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../../../scripts/test/support/temporary-mysql-harness.mjs'
const here = import.meta.dirname
const schema = readFileSync(resolve(here, '../../../../console/docs/hzy_console_schema.sql'), 'utf8')
const table = name => schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS \`${name}\` \\([\\s\\S]*?\\) ENGINE=[^;]*;`))[0]
const sql = f => readFileSync(resolve(here, f), 'utf8')
const fact = /SELECT (\d+) AS id,'((?:[^']|'')*)' AS resource_code,'((?:[^']|'')*)' AS action,'([^']+)' AS audience,'((?:[^']|'')*)' AS old_json/g
const facts = [...sql('b17-console-runtime-audience-facts.sql').matchAll(fact)].map(m => ({ id: Number(m[1]), resource: m[2], action: m[3], audience: m[4], old: m[5].replace(/''/g, "'") }))
assert.equal(facts.length, 86)
assert.equal(new Set(facts.map(f => f.id)).size, 86, 'ids are unique')
for (const f of facts) assert.ok(['data-runtime', 'tenant-runtime', 'connector-runtime', 'notification-runtime', 'aims', 'altoc', 'assets', 'finance', 'people', 'webdev', 'workflow'].includes(f.audience))
const excluded = [2453, 9676, 76763, 54638787, 54638788, 69143051, 69143052]
assert.ok(excluded.every(id => !facts.some(f => f.id === id)), 'the five excluded rows are not listed')
assert.equal([...sql('b17-console-runtime-audience-facts.rollback.sql').matchAll(/SELECT (\d+) AS id,/g)].length, 86)
const plan = await buildTemporaryMySqlPlan({ rootDir: resolve(here, '../../../..'), mysqld: process.env.MYSQLD || 'mysqld', mysql: process.env.MYSQL || 'mysql' })
await withTemporaryMySql(plan, async (context) => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  try {
    await db.query('SET FOREIGN_KEY_CHECKS=0'); await db.query(table('service_clients')); await db.query(table('service_client_grants'))
    await db.query(`INSERT INTO service_clients(id,client_code,client_name,app_code,status) VALUES(3,'console.runtime','Console','console','active'),(4,'aims.runtime','Aims','aims','active')`)
    const legacy = '{"source": "tenant-runtime-bootstrap"}'
    const ins = (id, cid, resource, action, json, status = 'active') => db.query('INSERT INTO service_client_grants(id,service_client_id,resource_code,action,scope_json,status) VALUES(?,?,?,?,?,?)', [id, cid, resource, action, json, status])
    const applied = async () => (await db.query(`SELECT COUNT(*) n FROM service_client_grants WHERE JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.audienceFacts'))='s4-b17-audience-facts'`))[0][0].n
    const snapshot = async () => (await db.query('SELECT id,service_client_id,resource_code,action,status,CAST(scope_json AS CHAR) sj,updated_at FROM service_client_grants ORDER BY id'))[0]
    const plain = rows => rows.map(r => ({ ...r, sj: r.sj === null ? null : JSON.stringify(JSON.parse(r.sj)), updated_at: undefined }))
    // 85 of 86 rows present -> guard stops everything
    for (const f of facts.slice(1)) await ins(f.id, 3, f.resource, f.action, f.old)
    for (const [id, r, a] of [[69143051, 'console:policy-bundle', 'read'], [69143052, 'console:policy-bundle', 'write'], [2453, 'workflow:action_defs', 'sync'], [9676, 'connector-runtime:directory', 'sync'], [76763, 'console.schema', 'read'], [54638787, 'console:hr-source-sync', 'view'], [54638788, 'console:hr-source-sync', 'admin']]) await ins(id, 3, r, a, legacy)
    await ins(900000001, 3, 'data-runtime:console:policy-bundle', 'read', '{"audience":"data-runtime","semanticScope":"console:policy-bundle:read"}')
    await ins(900000002, 4, facts[0].resource, facts[0].action, legacy)
    const before = await snapshot()
    await db.query(sql('b17-console-runtime-audience-facts.sql')); assert.equal(await applied(), 0, 'guard: a listed row is missing -> nothing written')
    assert.deepEqual(await snapshot(), before)
    // the missing row is present but revoked -> still nothing
    await ins(facts[0].id, 3, facts[0].resource, facts[0].action, facts[0].old, 'revoked')
    await db.query(sql('b17-console-runtime-audience-facts.sql')); assert.equal(await applied(), 0, 'guard: revoked row -> nothing written')
    // the row is active but its scope_json drifted -> CAS guard stops everything
    await db.query(`UPDATE service_client_grants SET status='active', scope_json='{"source": "tenant-runtime-bootstrap", "x": 1}' WHERE id=?`, [facts[0].id])
    await db.query(sql('b17-console-runtime-audience-facts.sql')); assert.equal(await applied(), 0, 'guard: drifted scope_json -> nothing written')
    await db.query(`UPDATE service_client_grants SET scope_json=? WHERE id=?`, [facts[0].old, facts[0].id])
    const pre = await snapshot()
    await db.query(sql('b17-console-runtime-audience-facts.sql')); assert.equal(await applied(), 86)
    const after = await snapshot()
    const old = new Map(pre.map(r => [r.id, r]))
    const listed = new Map(facts.map(f => [f.id, f]))
    for (const r of after) {
      const o = old.get(r.id); assert.equal(r.resource_code, o.resource_code); assert.equal(r.action, o.action); assert.equal(r.status, o.status); assert.equal(r.service_client_id, o.service_client_id)
      const f = listed.get(r.id)
      if (f) assert.deepEqual(JSON.parse(r.sj), { source: 'tenant-runtime-bootstrap', audience: f.audience, semanticScope: `${f.resource}:${f.action}`, audienceFacts: 's4-b17-audience-facts' })
      else assert.equal(r.sj, o.sj, `untouched row ${r.id}`)
    }
    assert.equal((await db.query('SELECT COUNT(*) n FROM service_client_grants'))[0][0].n, pre.length, 'no rows added')
    await db.query(sql('b17-console-runtime-audience-facts.sql')); assert.equal(await applied(), 86, 'second run: no-op (CAS no longer matches)')
    assert.deepEqual(plain(await snapshot()), plain(after))
    await db.query(sql('b17-console-runtime-audience-facts.rollback.sql'))
    assert.equal(await applied(), 0)
    assert.deepEqual(plain(await snapshot()), plain(pre), 'rollback restores every scope_json exactly')
    console.log('b17 console.runtime audience facts test: OK (guards, exact 86-row update, other rows untouched, second run no-op, rollback exact)')
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
