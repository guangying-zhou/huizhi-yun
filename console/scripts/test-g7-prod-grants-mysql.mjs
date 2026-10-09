import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { applyG7, planG7, readG7State, rollbackG7, verifyG7 } from './g7-prod-grants.mjs'
import { validateG7Bindings } from './g7-prod-grant-catalog.mjs'

const scopeJson = row => typeof row.scope_json === 'string' ? JSON.parse(row.scope_json) : row.scope_json
const bindings = { tenant: 'C000001', deployments: {
  enterprise: 'C000001-prod-enterprise', workflow: 'C000001-workflow',
  aims: 'C000001-aims', codocs: 'C000001-codocs', console: 'C000001-console' } }
assert.throws(() => validateG7Bindings({ ...bindings, deployments: {
  ...bindings.deployments, workflow: 'C000001-prod-workflow' } }), /reviewed production deployment code/)
const plan = await buildTemporaryMySqlPlan({ rootDir: resolve(import.meta.dirname, '../..') })
await withTemporaryMySql(plan, async (context) => {
  const db = await mysql.createConnection({ ...context.connection('console'), dateStrings: true, multipleStatements: true })
  try {
    await db.query(`CREATE TABLE service_clients(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,client_code VARCHAR(128) NOT NULL UNIQUE,
      client_name VARCHAR(255) NOT NULL,client_type VARCHAR(32) NOT NULL,app_code VARCHAR(64),
      description VARCHAR(500),current_credential_id BIGINT UNSIGNED,status VARCHAR(32) NOT NULL,
      created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      CREATE TABLE auth_clients(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,client_id VARCHAR(128) NOT NULL UNIQUE,
      client_name VARCHAR(255) NOT NULL,app_code VARCHAR(64),client_type VARCHAR(32) NOT NULL,
      auth_mode VARCHAR(32) NOT NULL,source VARCHAR(32) NOT NULL,status VARCHAR(32) NOT NULL,
      created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      CREATE TABLE service_client_grants(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT UNSIGNED NOT NULL,
      resource_code VARCHAR(128) NOT NULL,action VARCHAR(32) NOT NULL,scope_json JSON,status VARCHAR(32) NOT NULL,
      created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL,
      UNIQUE KEY uk_grant(service_client_id,resource_code,action)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      INSERT INTO service_clients VALUES
      (1,'workflow.runtime','Workflow','app','workflow',NULL,11,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
      (2,'aims.runtime','Aims','app','aims',NULL,12,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
      (3,'console.runtime','Console','app','console',NULL,13,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
      (4,'codocs.runtime','Codocs','app','codocs',NULL,14,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP());`)
    const insert = async (client, resource, action, scope, status = 'active') => {
      await db.query(`INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
        VALUES(?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`, [client, resource, action, scope == null ? null : JSON.stringify(scope), status])
    }
    await insert(1, 'data-runtime:workflow:integration_operations', 'execute', null)
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      await insert(2, `${audience}:aims:integration_operation`, 'execute', { audience, source: 'old-aims' })
      await insert(2, `${audience}:aims:integration_operations`, 'execute', { audience, source: 'old-aims-plural' })
    }
    await insert(2, 'aims:integration_operation', 'execute', { source: 'old-unbound-alias' })
    for (const action of ['read', 'write']) await insert(3, 'console:policy-bundle', action, { source: 'policy-bundle-install' })
    await insert(4, 'codocs:documents', 'read', { source: 'unrelated' })
    const ossRows = [
      [439, 'integration_config', 'view'], [440, 'credential_vault', 'resolve'],
      [628435, 'data-runtime:credential_vault', 'resolve'], [628436, 'data-runtime:integration_config', 'view'],
      [628447, 'tenant-runtime:credential_vault', 'resolve'], [628448, 'tenant-runtime:integration_config', 'view']
    ]
    for (const [id, resource, action] of ossRows) {
      const scope = { source: `seed:legacy-${id}`, integrationCodes: ['oss.default'],
        ...(action === 'resolve' ? { usageTypes: ['integration'] } : {}), purpose: 'codocs-document-storage' }
      await db.query(`INSERT INTO service_client_grants(id,service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
        VALUES(?,4,?,?,?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())`, [id, resource, action, JSON.stringify(scope)])
    }
    const original = await readG7State(db)
    const review = planG7(original, bindings)
    assert.deepEqual(review.operations.filter(op => op.kind === 'bind' && ossRows.some(([id]) => id === op.id)).map(op => op.id).sort((a, b) => a - b),
      ossRows.map(([id]) => id).sort((a, b) => a - b))
    await db.query('UPDATE service_client_grants SET status=\'revoked\' WHERE id=439')
    const revokedOss = await readG7State(db)
    assert.throws(() => planG7(revokedOss, bindings), /G7_REVOKED_PHYSICAL_GRANT/)
    await db.query('UPDATE service_client_grants SET status=\'active\' WHERE id=439')
    await db.query('UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,\'$.audience\',\'console\') WHERE id=439')
    const conflictingOss = await readG7State(db)
    assert.throws(() => planG7(conflictingOss, bindings), /G7_AUDIENCE_CONFLICT/)
    await db.query('UPDATE service_client_grants SET scope_json=? WHERE id=439', [JSON.stringify(original.grants.find(row => Number(row.id) === 439).scope_json)])
    await db.query('UPDATE service_client_grants SET resource_code=\'missing-fixture\' WHERE id=440')
    const missingOss = await readG7State(db)
    assert.throws(() => planG7(missingOss, bindings), /G7_CODOCS_OSS_GRANT_MISSING/)
    await db.query('UPDATE service_client_grants SET resource_code=\'credential_vault\' WHERE id=440')
    assert.equal(review.createServiceClient, true)
    assert.equal(review.createOidcClient, true)
    assert.ok(review.operations.some(op => op.kind === 'revoke' && op.before.resource_code === 'aims:integration_operation'))
    await insert(2, 'data-runtime:aims:milestone-rollover', 'execute', { source: 'revoked-old' }, 'revoked')
    const withRevoked = await readG7State(db)
    assert.throws(() => planG7(withRevoked, bindings), /G7_REVOKED_PHYSICAL_GRANT/)
    await db.query('DELETE FROM service_client_grants WHERE resource_code=\'data-runtime:aims:milestone-rollover\' AND status=\'revoked\'')
    await assert.rejects(applyG7(db, bindings, '0'.repeat(64)), /G7_REVIEW_HASH_CHANGED/)
    await assert.rejects(applyG7(db, bindings, review.reviewHash, async (connection) => {
      await connection.query('UPDATE service_client_grants SET action=\'write\' WHERE service_client_id=4 AND resource_code=\'codocs:documents\'')
    }), /G7_NON_TARGET_CHANGED/)
    await assert.rejects(applyG7(db, bindings, review.reviewHash, async (connection) => {
      await connection.query('UPDATE service_clients SET client_name=\'tampered\' WHERE client_code=\'codocs.runtime\'')
    }), /G7_OTHER_CLIENT_CHANGED/)
    const receipt = await applyG7(db, bindings, review.reviewHash)
    assert.deepEqual(verifyG7(await readG7State(db), bindings), { expected: 34, active: 34, consolePolicy: 2, legacyPlural: 0, notificationsDue: 0 })
    const boundOss = (await readG7State(db)).grants.filter(row => ossRows.some(([id]) => id === Number(row.id)))
    for (const row of boundOss) {
      const prior = original.grants.find(item => Number(item.id) === Number(row.id))
      const before = typeof prior.scope_json === 'string' ? JSON.parse(prior.scope_json) : prior.scope_json
      const after = typeof row.scope_json === 'string' ? JSON.parse(row.scope_json) : row.scope_json
      for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], `${row.id}:${key} changed`)
      const audience = row.resource_code.startsWith('tenant-runtime:') ? 'tenant-runtime' : 'data-runtime'
      assert.equal(after.audience, audience)
      assert.equal(after.semanticScope, `${row.resource_code}:${row.action}`)
      assert.equal(after.tenantCode, bindings.tenant)
      assert.equal(after.deploymentCode, bindings.deployments.codocs)
      assert.equal(row.status, prior.status)
    }
    for (const scope of ['integration_config:view', 'credential_vault:resolve']) {
      assert.equal(boundOss.filter((row) => {
        const policy = typeof row.scope_json === 'string' ? JSON.parse(row.scope_json) : row.scope_json
        return policy.audience === 'data-runtime' && policy.semanticScope === scope
      }).length, 1, `${scope} signing mapping must be unambiguous`)
    }
    // Mirrors the issuer's audience + semantic/physical matching rule against
    // the disposable MySQL rows, including the prefixed legacy scopes.
    for (const row of boundOss) {
      const policy = typeof row.scope_json === 'string' ? JSON.parse(row.scope_json) : row.scope_json
      const [matches] = await db.query(`SELECT COUNT(*) AS n FROM service_client_grants g
        WHERE g.service_client_id=4 AND g.status='active'
          AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=?
          AND (JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=?
            OR (CONCAT(g.resource_code,':',g.action)=? AND ? LIKE CONCAT(? ,':%')))`,
      [policy.audience, policy.semanticScope, policy.semanticScope, policy.semanticScope, policy.audience])
      assert.equal(Number(matches[0].n), 1, `issuer mapping conflict for ${row.id}`)
    }
    const roleHolder = (await readG7State(db)).grants.find(row => row.resource_code === 'console:authorization-role-holders')
    assert.deepEqual((typeof roleHolder.scope_json === 'string' ? JSON.parse(roleHolder.scope_json) : roleHolder.scope_json).roleCodes, ['project_director'])
    await db.query('UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,\'$.roleCodes\',JSON_ARRAY(\'project_director\',\'qa\')) WHERE id=?', [roleHolder.id])
    const widened = await readG7State(db)
    assert.throws(() => verifyG7(widened, bindings), /G7_VERIFY_FAILED/)
    await db.query('UPDATE service_client_grants SET scope_json=? WHERE id=?', [typeof roleHolder.scope_json === 'string' ? roleHolder.scope_json : JSON.stringify(roleHolder.scope_json), roleHolder.id])
    assert.equal(planG7(await readG7State(db), bindings).operations.length, 0, 'second apply plan is empty')
    const replay = await applyG7(db, bindings, planG7(await readG7State(db), bindings).reviewHash)
    assert.deepEqual(replay.inserted.grants, [])
    await assert.rejects(rollbackG7(db, { ...receipt, appliedTargetsHash: '0'.repeat(64) }), /G7_ROLLBACK_TARGET_DRIFT/)
    // Replaying a no-op apply does not change the first receipt's target rows.
    await rollbackG7(db, receipt)
    const restored = await readG7State(db)
    assert.deepEqual(restored.grants, original.grants)
    assert.deepEqual(restored.clients, original.clients)
    assert.deepEqual(restored.oidcClients, original.oidcClients)
    // Optional standalone Collab identity: 34 + 2 exact grants, own client row,
    // pre-collaboration plans unchanged, rollback restores byte-identical state.
    const withCollab = { ...bindings, deployments: { ...bindings.deployments, collab: 'C000001-collab' } }
    assert.throws(() => validateG7Bindings({ ...withCollab, deployments: { ...withCollab.deployments, collab: 'C000001-prod-collab' } }), /reviewed production deployment code/)
    const collabPlan = planG7(await readG7State(db), withCollab)
    assert.equal(collabPlan.createCollabClient, true)
    assert.equal(collabPlan.operations.filter(op => op.client === 'collab.runtime' && op.kind === 'insert').length, 2)
    assert.equal(planG7(await readG7State(db), bindings).createCollabClient, undefined)
    await db.query('INSERT INTO service_clients VALUES(9,\'collab.runtime\',\'Other\',\'app\',\'aims\',NULL,NULL,\'active\',UTC_TIMESTAMP(),UTC_TIMESTAMP())')
    const conflictingCollab = await readG7State(db)
    assert.throws(() => planG7(conflictingCollab, withCollab), /G7_COLLAB_CLIENT_CONFLICT/)
    await db.query('DELETE FROM service_clients WHERE id=9')
    const collabReceipt = await applyG7(db, withCollab, collabPlan.reviewHash)
    assert.ok(collabReceipt.inserted.collabClient)
    assert.deepEqual(verifyG7(await readG7State(db), withCollab), { expected: 36, active: 36, consolePolicy: 2, legacyPlural: 0, notificationsDue: 0 })
    const collabRows = (await readG7State(db)).grants.filter(row => row.client_code === 'collab.runtime')
    assert.deepEqual(collabRows.map(row => `${row.resource_code}:${row.action}`).sort(),
      ['data-runtime:codocs:collaboration-snapshots:publish', 'data-runtime:codocs:collaboration-snapshots:read'])
    for (const row of collabRows) assert.deepEqual(scopeJson(row), { source: 'seed:g7-prod-service-grants', tenantCode: 'C000001', deploymentCode: 'C000001-collab',
      audience: 'data-runtime', semanticScope: `${row.resource_code.slice('data-runtime:'.length)}:${row.action}` })
    assert.equal(planG7(await readG7State(db), withCollab).operations.length, 0, 'collab second plan is empty')
    await rollbackG7(db, collabReceipt)
    const afterCollabRollback = await readG7State(db)
    assert.deepEqual(afterCollabRollback.grants, original.grants)
    assert.deepEqual(afterCollabRollback.clients, original.clients)
    // P0-12 (R3 rehearsal): production seed v1.92 rows for aims.runtime carry an audience-prefixed
    // semanticScope and no `audience` key. Reproduce the exact production shape and prove the
    // plan -> apply -> verify -> rollback cycle, the issuer mapping before/after, and the narrow alias rule.
    const prodPurpose = 'aims-integration-operation-worker'
    const prodShape = audience => ({ source: 'seed:v1.92', purpose: prodPurpose, semanticScope: `${audience}:aims:integration_operation:execute` })
    // Same logic as data-runtime mapServiceAudienceScopes (audience-bound grants only; unbound grants never authorize).
    const issuerAllows = (row, audience, scope) => {
      const policy = scopeJson(row) || {}
      const bound = typeof policy.audience === 'string' ? policy.audience.trim() : ''
      if (!bound) return false
      const physical = `${row.resource_code}:${row.action}`
      return bound === audience && ((physical === scope && scope.startsWith(`${audience}:`)) || String(policy.semanticScope || '').trim() === scope)
    }
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      await db.query('UPDATE service_client_grants SET scope_json=? WHERE service_client_id=2 AND resource_code=?', [JSON.stringify(prodShape(audience)), `${audience}:aims:integration_operation`])
    }
    const prodBefore = await readG7State(db)
    const prodRows = prodBefore.grants.filter(row => row.client_code === 'aims.runtime' && /^(data|tenant)-runtime:aims:integration_operation$/.test(row.resource_code))
    assert.equal(prodRows.length, 2)
    for (const row of prodRows) {
      const audience = row.resource_code.split(':')[0]
      assert.equal(issuerAllows(row, audience, 'aims:integration_operation:execute'), false, 'before: short scope cannot be issued')
      assert.equal(issuerAllows(row, audience, `${row.resource_code}:execute`), false, 'before: physical scope cannot be issued')
    }
    const prodPlan = planG7(prodBefore, bindings)
    assert.deepEqual(prodPlan.operations.filter(op => prodRows.some(row => Number(row.id) === op.id)).map(op => op.kind), ['bind', 'bind'])
    for (const op of prodPlan.operations.filter(op => prodRows.some(row => Number(row.id) === op.id))) {
      const audience = op.before.resource_code.split(':')[0]
      assert.equal(scopeJson(op.before).semanticScope, `${audience}:aims:integration_operation:execute`, 'plan records the original semanticScope')
      assert.equal(op.after.semanticScope, 'aims:integration_operation:execute')
      assert.equal(op.after.audience, audience)
      assert.equal(op.after.purpose, prodPurpose, 'other fields are preserved')
    }
    const prodReceipt = await applyG7(db, bindings, prodPlan.reviewHash)
    assert.equal(verifyG7(await readG7State(db), bindings).expected, 34)
    const prodAfter = (await readG7State(db)).grants.filter(row => prodRows.some(r => Number(r.id) === Number(row.id)))
    for (const row of prodAfter) {
      const audience = row.resource_code.split(':')[0]
      assert.equal(issuerAllows(row, audience, 'aims:integration_operation:execute'), true, 'after: short scope can be issued')
      assert.equal(issuerAllows(row, audience, `${row.resource_code}:execute`), true, 'after: physical scope still resolves to the same grant')
      assert.equal(issuerAllows(row, audience === 'data-runtime' ? 'tenant-runtime' : 'data-runtime', 'aims:integration_operation:execute'), false, 'other audience is refused')
    }
    assert.deepEqual(prodReceipt.restoredRows.filter(r => prodRows.some(x => Number(x.id) === r.id)).map(r => scopeJson(r.before).semanticScope).sort(),
      ['data-runtime:aims:integration_operation:execute', 'tenant-runtime:aims:integration_operation:execute'])
    await rollbackG7(db, prodReceipt)
    const prodRestored = await readG7State(db)
    assert.deepEqual(prodRestored.grants, prodBefore.grants, 'rollback restores the original semanticScope byte for byte')
    assert.deepEqual(prodRestored.clients, prodBefore.clients)
    // Narrow rule: only `<this row's audience>:<short scope>` is an alias; everything else still conflicts.
    const mutate = mutator => ({ ...prodBefore, grants: prodBefore.grants.map((row) => {
      if (Number(row.id) !== Number(prodRows.find(r => r.resource_code === 'tenant-runtime:aims:integration_operation').id)) return row
      return { ...row, scope_json: JSON.stringify(mutator(scopeJson(row))) }
    }) })
    for (const bad of ['data-runtime:aims:integration_operation:execute', 'unknown:aims:integration_operation:execute',
      'AIMS:integration_operation:execute', 'Tenant-Runtime:aims:integration_operation:execute',
      'tenant-runtime:tenant-runtime:aims:integration_operation:execute', 'tenant-runtime:aims:integration_operation:executed', ' tenant-runtime:aims:integration_operation:execute']) {
      assert.throws(() => planG7(mutate(policy => ({ ...policy, semanticScope: bad })), bindings), /G7_SEMANTIC_CONFLICT/, `must conflict: ${bad}`)
    }
    assert.throws(() => planG7(mutate(policy => ({ ...policy, audience: 'data-runtime' })), bindings), /G7_AUDIENCE_CONFLICT/)
    assert.doesNotThrow(() => planG7(mutate(policy => ({ ...policy, semanticScope: 'aims:integration_operation:execute' })), bindings))
    console.log(JSON.stringify({ fixture: '/tmp disposable MySQL', plan: 'PASS', reviewHash: 'PASS', seedRepair: 'PASS', verify: 'PASS', nonTargetRollback: 'PASS', idempotent: 'PASS', rollback: 'PASS' }))
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
