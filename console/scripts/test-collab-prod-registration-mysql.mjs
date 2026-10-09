import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { COLLAB_CAPABILITIES, collabGrantItems, validateCollabBindings } from './g7-prod-grant-catalog.mjs'
import { applyCollab, planCollab, readCollabState, rollbackCollab, verifyCollab } from './collab-prod-registration.mjs'

const bindings = { tenant: 'C000001', deployments: { collab: 'C000001-collab' } }
const scopeJson = row => typeof row.scope_json === 'string' ? JSON.parse(row.scope_json) : row.scope_json

// Catalog contract: exactly the two capabilities collab/src/utils/v2-snapshots.ts requests.
assert.deepEqual([...COLLAB_CAPABILITIES], ['codocs:collaboration-snapshots:read', 'codocs:collaboration-snapshots:publish'])
assert.deepEqual(collabGrantItems(bindings).map(item => [item.audience, item.resource, item.action, item.deployment]),
  COLLAB_CAPABILITIES.map(scope => ['data-runtime', 'data-runtime:codocs:collaboration-snapshots', scope.split(':').pop(), 'C000001-collab']))
for (const bad of [
  { tenant: 'C000001', deployments: { collab: 'C000001-prod-collab' } },
  { tenant: 'C000001', deployments: { collab: 'C000002-collab' } },
  { tenant: 'c000001', deployments: { collab: 'c000001-collab' } }
]) assert.throws(() => validateCollabBindings(bad))
// The binding defaults to the Platform-registered `${tenant}-collab` (G-9 registration), identically to the explicit form.
assert.deepEqual(validateCollabBindings({ tenant: 'C000001' }), bindings)
assert.deepEqual(validateCollabBindings({ tenant: 'C000001', deployments: {} }), bindings)
assert.deepEqual(collabGrantItems({ tenant: 'C000001' }), collabGrantItems(bindings))
assert.equal(planCollab({ clients: [], grants: [] }, { tenant: 'C000001' }).reviewHash, planCollab({ clients: [], grants: [] }, bindings).reviewHash)

const plan = await buildTemporaryMySqlPlan({ rootDir: resolve(import.meta.dirname, '../..') })
await withTemporaryMySql(plan, async (context) => {
  const db = await mysql.createConnection({ ...context.connection('console'), dateStrings: true, multipleStatements: true })
  try {
    await db.query(`CREATE TABLE service_clients(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,client_code VARCHAR(128) NOT NULL UNIQUE,
      client_name VARCHAR(255) NOT NULL,client_type VARCHAR(32) NOT NULL,app_code VARCHAR(64),
      description VARCHAR(500),current_credential_id BIGINT UNSIGNED,status VARCHAR(32) NOT NULL,
      created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      CREATE TABLE service_client_grants(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT UNSIGNED NOT NULL,
      resource_code VARCHAR(128) NOT NULL,action VARCHAR(32) NOT NULL,scope_json JSON,status VARCHAR(32) NOT NULL,
      created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL,
      UNIQUE KEY uk_grant(service_client_id,resource_code,action)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      INSERT INTO service_clients VALUES
      (1,'enterprise.runtime','Enterprise','app','enterprise',NULL,21,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
      (2,'codocs.runtime','Codocs','app','codocs',NULL,22,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP());
      INSERT INTO service_client_grants VALUES
      (NULL,1,'data-runtime:codocs:enterprise-host','execute','{"audience":"data-runtime","semanticScope":"codocs:enterprise-host:execute"}','active',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
      (NULL,2,'codocs','write','{"source":"unrelated"}','active',UTC_TIMESTAMP(),UTC_TIMESTAMP());`)
    const original = await readCollabState(db)

    // plan is read-only and deterministic
    const review = planCollab(original, bindings)
    assert.equal(review.createServiceClient, true)
    assert.deepEqual(review.operations.map(op => [op.kind, op.scope]), COLLAB_CAPABILITIES.map(scope => ['insert', scope]))
    assert.equal(planCollab(await readCollabState(db), bindings).reviewHash, review.reviewHash)
    assert.deepEqual(await readCollabState(db), original)

    // review hash, drift and non-target guards; every failure leaves the database untouched
    await assert.rejects(applyCollab(db, bindings, '0'.repeat(64)), /COLLAB_REVIEW_HASH_CHANGED/)
    await assert.rejects(applyCollab(db, bindings, review.reviewHash, async (connection) => {
      await connection.query('UPDATE service_client_grants SET action=\'admin\' WHERE service_client_id=2')
    }), /COLLAB_NON_TARGET_CHANGED/)
    await assert.rejects(applyCollab(db, bindings, review.reviewHash, async (connection) => {
      await connection.query('UPDATE service_clients SET client_name=\'tampered\' WHERE client_code=\'codocs.runtime\'')
    }), /COLLAB_OTHER_CLIENT_CHANGED/)
    assert.deepEqual(await readCollabState(db), original)

    // apply -> verify
    const receipt = await applyCollab(db, bindings, review.reviewHash)
    const applied = await readCollabState(db)
    const client = applied.clients.find(row => row.client_code === 'collab.runtime')
    assert.equal(client.app_code, 'collab')
    assert.equal(client.current_credential_id, null, 'no credential is created by the registration')
    const rows = applied.grants.filter(row => row.client_code === 'collab.runtime')
    assert.equal(rows.length, 2)
    for (const row of rows) assert.deepEqual(scopeJson(row), { source: 'seed:g7-prod-service-grants', tenantCode: 'C000001',
      deploymentCode: 'C000001-collab', audience: 'data-runtime', semanticScope: `codocs:collaboration-snapshots:${row.action}` })
    assert.deepEqual(verifyCollab(applied, bindings), { expected: 2, active: 2, currentCredentialPointer: false, tokenIssuanceVerified: false })

    // idempotent second plan; a replay applies nothing
    const second = planCollab(applied, bindings)
    assert.equal(second.operations.length, 0)
    const replay = await applyCollab(db, bindings, second.reviewHash)
    assert.deepEqual(replay.inserted, { grants: [], serviceClient: null })

    // verify fails closed on widening, drift and revocation; plan refuses to adopt or resurrect
    await db.query('INSERT INTO service_client_grants VALUES(NULL,?,\'data-runtime:codocs:enterprise-host\',\'execute\',\'{}\',\'active\',UTC_TIMESTAMP(),UTC_TIMESTAMP())', [client.id])
    const widened = await readCollabState(db)
    assert.throws(() => verifyCollab(widened, bindings), /COLLAB_VERIFY_FAILED/)
    assert.throws(() => planCollab(widened, bindings), /COLLAB_UNEXPECTED_ACTIVE_GRANT/)
    await db.query('DELETE FROM service_client_grants WHERE resource_code=\'data-runtime:codocs:enterprise-host\' AND service_client_id=?', [client.id])
    const target = rows.find(row => row.action === 'publish')
    await db.query('UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,\'$.deploymentCode\',\'C000001-other\') WHERE id=?', [target.id])
    const drifted = await readCollabState(db)
    assert.throws(() => verifyCollab(drifted, bindings), /COLLAB_VERIFY_FAILED/)
    await db.query('UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,\'$.audience\',\'tenant-runtime\') WHERE id=?', [target.id])
    const foreign = await readCollabState(db)
    assert.throws(() => planCollab(foreign, bindings), /COLLAB_AUDIENCE_CONFLICT|COLLAB_FOREIGN_BINDING/)
    await db.query('UPDATE service_client_grants SET scope_json=?,status=? WHERE id=?', [JSON.stringify(scopeJson(target)), 'revoked', target.id])
    const revoked = await readCollabState(db)
    assert.throws(() => verifyCollab(revoked, bindings), /COLLAB_VERIFY_FAILED/)
    assert.throws(() => planCollab(revoked, bindings), /COLLAB_REVOKED_GRANT/)
    await db.query('UPDATE service_client_grants SET status=? WHERE id=?', ['active', target.id])

    // repair path: an unbound (audience-less) but otherwise exact row is bound, not duplicated
    await db.query('UPDATE service_client_grants SET scope_json=JSON_OBJECT(\'source\',\'legacy\') WHERE id=?', [target.id])
    const repair = planCollab(await readCollabState(db), bindings)
    assert.deepEqual(repair.operations.map(op => [op.kind, op.id]), [['bind', Number(target.id)]])

    // rollback refuses target drift, then restores the fixture byte for byte; a credential blocks removal
    await db.query('UPDATE service_client_grants SET scope_json=? WHERE id=?', [JSON.stringify(scopeJson(target)), target.id])
    await assert.rejects(rollbackCollab(db, { ...receipt, appliedTargetsHash: '0'.repeat(64) }), /COLLAB_ROLLBACK_TARGET_DRIFT/)
    await db.query('UPDATE service_clients SET current_credential_id=99 WHERE id=?', [client.id])
    await assert.rejects(rollbackCollab(db, receipt), /COLLAB_ROLLBACK_OTHER_CLIENT_DRIFT|COLLAB_ROLLBACK_CREDENTIAL_ISSUED/)
    await db.query('UPDATE service_clients SET current_credential_id=NULL WHERE id=?', [client.id])
    assert.deepEqual(await rollbackCollab(db, receipt), { restored: 0, removed: 2 })
    assert.deepEqual(await readCollabState(db), original)

    // a same-named client owned by another app is never adopted
    await db.query('INSERT INTO service_clients VALUES(9,\'collab.runtime\',\'Other\',\'app\',\'aims\',NULL,NULL,\'active\',UTC_TIMESTAMP(),UTC_TIMESTAMP())')
    const conflict = await readCollabState(db)
    assert.throws(() => planCollab(conflict, bindings), /COLLAB_CLIENT_CONFLICT/)
    console.log(JSON.stringify({ fixture: '/tmp disposable MySQL', plan: 'PASS', reviewHash: 'PASS', apply: 'PASS', verify: 'PASS', idempotent: 'PASS', failClosed: 'PASS', rollback: 'PASS' }))
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
