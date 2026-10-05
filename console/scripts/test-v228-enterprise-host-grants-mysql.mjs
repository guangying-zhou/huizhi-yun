import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { applyV228, planV228, readV228Rows } from './v228-enterprise-host-grants.mjs'

const plan = await buildTemporaryMySqlPlan({ rootDir: resolve(import.meta.dirname, '../..') })
await withTemporaryMySql(plan, async context => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true, dateStrings: true })
  try {
    // Mirror Console: unicode_ci tables inside a schema whose default (and so
    // every temporary table's) collation is MySQL 8's utf8mb4_0900_ai_ci.
    await db.query('ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci')
    await db.query(`CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(100),app_code VARCHAR(50)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      CREATE TABLE service_client_grants(id BIGINT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(200),action VARCHAR(50),scope_json JSON,status VARCHAR(20),updated_at DATETIME) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      INSERT INTO service_clients VALUES(1,'enterprise.runtime','enterprise'),(2,'workflow.runtime','workflow'),(3,'aims.runtime','aims'),(4,'codocs.runtime','codocs');`)
    const insert = async (id, client, resource, action, status, audience, semanticScope, source = 'enterprise-test-pilot') => {
      await db.query(`INSERT INTO service_client_grants VALUES(?,?,?,?,?,?,UTC_TIMESTAMP())`,
        [id, client, resource, action, JSON.stringify({ audience, semanticScope, source, tenantCode: 'C000001' }), status])
    }
    for (const [i, domain] of ['aims', 'assets', 'codocs', 'altoc', 'console'].entries())
      await insert(100 + i, 1, `data-runtime:${domain}:enterprise-host`, 'execute', 'active', 'data-runtime', `${domain}:enterprise-host:execute`, 'seed:v2.27')
    for (const [i, audience] of ['data-runtime', 'tenant-runtime'].entries()) {
      await insert(200 + i, 2, `${audience}:workflow:integration_operation`, 'execute', 'active', audience, 'workflow:integration_operation:execute', 'seed:v2.29')
      for (const [j, resource] of ['integration_operation', 'notifications-due', 'milestone-rollover'].entries())
        await insert(210 + i * 3 + j, 3, `${audience}:aims:${resource}`, 'execute', 'active', audience, `aims:${resource}:execute`, 'seed:v2.31')
    }
    // D2's actual tenant-runtime grant and the two v2.26 IDs are in scope.
    await insert(13227385, 1, 'tenant-runtime:console:directory-self', 'read', 'active', 'tenant-runtime', 'console:directory-self:read', 'seed:d2-codocs-enterprise-directory-self-read')
    await insert(13227427, 1, 'data-runtime:aims:admin-projects', 'view', 'active', 'data-runtime', 'aims:admin-projects:view', 'seed:enterprise-aims-admin-projects')
    await insert(13227428, 1, 'data-runtime:aims:admin-projects', 'edit', 'active', 'data-runtime', 'aims:admin-projects:edit', 'seed:enterprise-aims-admin-projects')
    await insert(301, 1, 'data-runtime:console:policy-bundle', 'read', 'active', 'data-runtime', 'console:policy-bundle:read')
    await insert(302, 1, 'notifications:notifications', 'publish', 'active', 'notifications', 'notifications:publish')
    await insert(303, 1, 'data-runtime:aims:projects', 'view', 'revoked', 'data-runtime', 'aims:projects:view')
    await insert(304, 1, 'console:directory-self', 'read', 'active', 'console', 'console:directory-self:read')
    await insert(305, 4, 'data-runtime:codocs:documents', 'read', 'active', 'data-runtime', 'codocs:documents:read')
    const before = planV228(await readV228Rows(db))
    assert.deepEqual(before.targets.map(row => row.id), [13227385, 13227427, 13227428])
    await assert.rejects(applyV228(db, '0'.repeat(64)), /V228_REVIEW_HASH_CHANGED/)
    assert.equal((await planV228(await readV228Rows(db))).targets.length, 3)
    await assert.rejects(applyV228(db, before.reviewHash, {
      afterUpdate: async connection => { await connection.query("UPDATE service_client_grants SET action='write' WHERE id=301") }
    }), /V228_NON_TARGET_TABLE_CHANGED/)
    const [[untouched]] = await db.query('SELECT action,status FROM service_client_grants WHERE id=301')
    assert.deepEqual(untouched, { action: 'read', status: 'active' })
    assert.equal((await planV228(await readV228Rows(db))).targets.length, 3, 'tampering rolled back target revoke')
    await assert.rejects(applyV228(db, before.reviewHash, {
      afterUpdate: async connection => { await connection.query("UPDATE service_client_grants SET action='write' WHERE id=305") }
    }), /V228_NON_TARGET_TABLE_CHANGED/)
    const [[otherClientUntouched]] = await db.query('SELECT action FROM service_client_grants WHERE id=305')
    assert.equal(otherClientUntouched.action, 'read')
    const result = await applyV228(db, before.reviewHash)
    assert.deepEqual(result.revokedIds, [13227385, 13227427, 13227428])
    assert.equal(result.protectedUnchanged, true)
    const [rows] = await db.query('SELECT id,status FROM service_client_grants WHERE id IN (301,302,303,304,13227385,13227427,13227428) ORDER BY id')
    assert.deepEqual(rows.map(row => row.status), ['active', 'active', 'revoked', 'active', 'revoked', 'revoked', 'revoked'])
    assert.equal(planV228(await readV228Rows(db)).targets.length, 0)
    await assert.rejects(applyV228(db, before.reviewHash), /V228_REVIEW_HASH_CHANGED/)
    // v2.29/v2.31 need not be installed before v2.28.
    await db.query('DELETE FROM service_client_grants WHERE id BETWEEN 200 AND 215')
    await db.query("UPDATE service_client_grants SET status='active' WHERE id IN (13227385,13227427,13227428)")
    const withoutScheduler = planV228(await readV228Rows(db))
    assert.equal(withoutScheduler.targets.length, 3)
    assert.equal((await applyV228(db, withoutScheduler.reviewHash)).revokedIds.length, 3)
    console.log(JSON.stringify({ fixture: '/tmp disposable MySQL', exactAudience: 'PASS', nonTargetTamperRollback: 'PASS', schedulerAbsent: 'PASS', drift: 'PASS', revoke: 'PASS', replay: 'PASS' }))
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
