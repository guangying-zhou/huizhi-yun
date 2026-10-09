import { planMigrationBaselines, registerMigrationBaselines } from '../server/utils/migrationBaselineReleases.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { loadEnvironmentAppSelection, pinsFromBundle, saveEnvironmentAppSelection, selectionReceipt, assertSelectionUnchanged } from '../server/utils/environmentAppReleases.ts'
import { hashPolicyBundlePayload } from '../server/utils/environmentPolicyPayload.ts'
import { stableStringifyPolicyPayload } from '../server/utils/policyEnvelopeDelivery.ts'

test('isolated MySQL: exact historical initialization, latest isolation, CAS audit, unavailable pins fail closed, reads do not mutate', async () => {
  const plan = await buildTemporaryMySqlPlan({ rootDir: new URL('../..', import.meta.url).pathname })
  let executed = false
  await withTemporaryMySql(plan, async (context: { socketPath: string }) => {
    executed = true
    const conn = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', multipleStatements: true })
    try {
      await conn.query('CREATE DATABASE env_pin_test; USE env_pin_test')
      const ddl = readFileSync(new URL('../docs/sql/HZY-Platform-SQL-Migration-environment-app-release-pins.sql', import.meta.url), 'utf8')
      await conn.query(ddl)
      await conn.query(ddl)
      await conn.query(`CREATE TABLE tenants(tenant_code VARCHAR(64) PRIMARY KEY);
    CREATE TABLE policy_bundles(id BIGINT PRIMARY KEY,tenant_code VARCHAR(64),environment VARCHAR(16),policy_revision BIGINT,bundle_hash VARCHAR(128),bundle_payload_json JSON,signature TEXT);
    CREATE TABLE platform_applications(app_code VARCHAR(64) PRIMARY KEY,status VARCHAR(16));
    CREATE TABLE platform_app_releases(id BIGINT PRIMARY KEY,app_code VARCHAR(64),release_version VARCHAR(64),source_tag VARCHAR(128),manifest_id BIGINT,status VARCHAR(16),released_at DATETIME);
    CREATE TABLE platform_app_manifests(id BIGINT PRIMARY KEY,app_code VARCHAR(64),manifest_hash VARCHAR(128),manifest_json JSON,status VARCHAR(16));
    CREATE TABLE platform_app_manifest_resources(id BIGINT PRIMARY KEY,app_code VARCHAR(64),manifest_id BIGINT,resource_code VARCHAR(64),resource_name VARCHAR(64),description TEXT,sort_order INT,status VARCHAR(16));
    CREATE TABLE platform_app_manifest_resource_actions(id BIGINT PRIMARY KEY,app_code VARCHAR(64),manifest_id BIGINT,resource_code VARCHAR(64),action VARCHAR(64),action_code VARCHAR(255),action_name VARCHAR(64),description TEXT,sort_order INT,requires_grant INT,status VARCHAR(16));
    INSERT INTO tenants VALUES('T'); INSERT INTO platform_applications VALUES ('console','active'),('finance','active');`)
      for (const [id, app] of [[1, 'console'], [2, 'finance'], [3, 'console'], [4, 'finance']] as const) {
        await conn.query('INSERT INTO platform_app_releases VALUES (?,?,?,?,?,?,?)', [id, app, `v${id}`, `${app}/v${id}`, id, 'released', `2026-10-0${id} 00:00:00`])
        await conn.query('INSERT INTO platform_app_manifests VALUES (?,?,?,?,?)', [id, app, `h${id}`, JSON.stringify({ recommendedRoles: [] }), 'active'])
        await conn.query('INSERT INTO platform_app_manifest_resources VALUES (?,?,?,\'overview\',\'Overview\',NULL,0,\'active\')', [id, app, id])
      }
      await conn.query('ALTER TABLE platform_app_releases ADD COLUMN source_commit_sha VARCHAR(64) NULL, ADD COLUMN source_registration_id BIGINT NULL, ADD COLUMN release_notes TEXT NULL, MODIFY id BIGINT NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uk_version(app_code,release_version)')
      const baselineDDL = readFileSync(new URL('../docs/sql/HZY-Platform-SQL-Migration-migration-baseline-releases.sql', import.meta.url), 'utf8')
      await conn.query(baselineDDL)
      await conn.query(baselineDDL)
      const payload = { tenant: { tenantCode: 'T' }, environment: 'prod', policyRevision: 39, manifestResources: [{ appCode: 'console', manifestId: 1 }, { appCode: 'finance', manifestId: 2 }] }
      const text = stableStringifyPolicyPayload(payload)
      await conn.query('INSERT INTO policy_bundles VALUES (40,?,?,39,?,?,?)', ['T', 'prod', hashPolicyBundlePayload(text), text, 'isolated-fixture-not-production-signature'])
      let writes = 0
      const q = {
        queryRows: async<T extends RowDataPacket[]>(sql: string, params: unknown[] = []) => (await conn.query<T>(sql, params))[0],
        queryRow: async<T extends RowDataPacket>(sql: string, params: unknown[] = []) => (await conn.query<T[]>(sql, params))[0][0] || null,
        execute: async<T extends ResultSetHeader>(sql: string, params: unknown[] = []) => {
          writes++
          return (await conn.query<T>(sql, params))[0]
        }
      }
      const reusePlan = await planMigrationBaselines(q, { tenant: 'T', environment: 'prod', bundleId: 40 })
      assert.deepEqual(reusePlan.entries.map(e => [e.mode, e.releaseId]), [['reuse', 1], ['reuse', 2]])
      const init = await pinsFromBundle(q, 'T', 'prod', 40)
      assert.deepEqual(init.pins, [{ appCode: 'console', releaseId: 1 }, { appCode: 'finance', releaseId: 2 }])
      assert.equal(await loadEnvironmentAppSelection(q, 'T', 'prod'), null)
      const draft = (await loadEnvironmentAppSelection(q, 'T', 'prod', { pins: init.pins, sourceBundleId: 40 }))!
      assert.equal(writes, 0, 'all initialization/selection preview reads have zero mutations')
      await conn.beginTransaction()
      await saveEnvironmentAppSelection(q, { tenant: 'T', environment: 'prod', actor: 'admin', reason: 'init from 39', expectedRevision: 0, selection: draft, reviewHash: 'a'.repeat(64), reviewEvidence: { diff: [{ field: 'roleDefaultScopes', removed: [{ sourceManifestActionId: 1 }], added: [{ sourceManifestActionId: 2 }] }], review: { version: 1, equivalent: [{ behaviorChanges: 0 }], real: [] }, sensitiveConfigurationChanged: false } })
      await conn.commit()
      const evidenceRow = await q.queryRow<RowDataPacket>('SELECT new_selection_json FROM platform_environment_app_release_audits ORDER BY id LIMIT 1')
      const evidence = typeof evidenceRow!.new_selection_json === 'string' ? JSON.parse(evidenceRow!.new_selection_json) : evidenceRow!.new_selection_json
      assert.equal(evidence.reviewEvidence.diff[0].removed[0].sourceManifestActionId, 1)
      assert.equal(evidence.reviewEvidence.review.equivalent[0].behaviorChanges, 0)
      const prod = (await loadEnvironmentAppSelection(q, 'T', 'prod'))!
      assert.equal(prod.revision, 1)
      assert.deepEqual(prod.releases.map(r => r.releaseId), [1, 2])
      const test = (await loadEnvironmentAppSelection(q, 'T', 'test', { pins: init.pins.map(p => ({ ...p, releaseId: null })), sourceBundleId: null }))!
      assert.deepEqual(test.releases.map(r => r.releaseId), [3, 4])
      assert.deepEqual((await loadEnvironmentAppSelection(q, 'T', 'prod'))!.releases.map(r => r.releaseId), [1, 2])
      await assert.rejects(pinsFromBundle(q, 'other', 'prod', 40), { statusCode: 409 })
      await assert.rejects(pinsFromBundle(q, 'T', 'test', 40), { statusCode: 409 })
      await assert.rejects(loadEnvironmentAppSelection(q, 'T', 'prod', { pins: [{ appCode: 'console', releaseId: 2 }], sourceBundleId: 40 }), { statusCode: 409 })
      const upgraded = (await loadEnvironmentAppSelection(q, 'T', 'prod', { pins: [{ appCode: 'console', releaseId: 3 }, { appCode: 'finance', releaseId: 2 }], sourceBundleId: 40 }))!
      await conn.beginTransaction()
      await saveEnvironmentAppSelection(q, { tenant: 'T', environment: 'prod', actor: 'admin', reason: 'console only', expectedRevision: 1, selection: upgraded, reviewHash: 'b'.repeat(64) })
      await conn.commit()
      assert.deepEqual((await loadEnvironmentAppSelection(q, 'T', 'prod'))!.releases.map(r => r.releaseId), [3, 2])
      await conn.beginTransaction()
      await assert.rejects(saveEnvironmentAppSelection(q, { tenant: 'T', environment: 'prod', actor: 'admin', reason: 'stale', expectedRevision: 1, selection: upgraded, reviewHash: 'c'.repeat(64) }), { statusCode: 409 })
      await conn.rollback()
      assert.equal((await q.queryRow<RowDataPacket>('SELECT COUNT(*) AS n FROM platform_environment_app_release_audits'))!.n, 2)
      await assert.rejects(assertSelectionUnchanged(q, 'T', 'prod', selectionReceipt(prod)), { statusCode: 409 })
      await conn.query('UPDATE platform_app_releases SET status=\'withdrawn\' WHERE id=3')
      await assert.rejects(loadEnvironmentAppSelection(q, 'T', 'prod'), { statusCode: 409 })
      await conn.query('UPDATE platform_app_releases SET status=\'released\' WHERE id=3')
      await conn.query('INSERT INTO platform_app_releases(id,app_code,release_version,source_tag,manifest_id,status,released_at) SELECT 9,app_code,\'alias\',\'console/alias\',manifest_id,status,released_at FROM platform_app_releases WHERE id=1')
      await assert.rejects(pinsFromBundle(q, 'T', 'prod', 40), { statusCode: 409 }, 'ambiguous release must not be guessed')
      await conn.query('DELETE FROM platform_app_releases WHERE id=9')
      await conn.query('UPDATE platform_app_releases SET status=\'draft\' WHERE id IN (1,2)')
      const plan = await planMigrationBaselines(q, { tenant: 'T', environment: 'prod', bundleId: 40 })
      assert.equal(plan.entries.filter(e => e.mode === 'baseline').length, 2)
      await conn.beginTransaction()
      const registered = await registerMigrationBaselines(q, { tenant: 'T', environment: 'prod', bundleId: 40, reviewHash: plan.reviewHash, actor: 'fixture-admin', reason: 'migration' })
      await conn.commit()
      await conn.beginTransaction()
      assert.deepEqual(await registerMigrationBaselines(q, { tenant: 'T', environment: 'prod', bundleId: 40, reviewHash: plan.reviewHash, actor: 'fixture-admin', reason: 'retry' }), registered)
      await conn.commit()
      assert.equal((await q.queryRow<RowDataPacket>('SELECT COUNT(*) AS n FROM platform_migration_baseline_audits'))!.n, 1)
      assert.deepEqual((await pinsFromBundle(q, 'T', 'prod', 40)).pins, registered.pins)
      const pinned = await loadEnvironmentAppSelection(q, 'T', 'prod', { pins: registered.pins, sourceBundleId: 40 })
      assert.deepEqual(pinned!.releases.map(r => r.manifestId), [1, 2])
      const latest = await loadEnvironmentAppSelection(q, 'T', 'test', { pins: registered.pins.map(p => ({ ...p, releaseId: null })), sourceBundleId: null })
      assert.deepEqual(latest!.releases.map(r => r.releaseId), [3, 4])
      assert.equal((await q.queryRow<RowDataPacket>('SELECT COUNT(*) AS n FROM platform_app_releases WHERE id IN (1,2) AND status=\'draft\''))!.n, 2)
      const baselineID = registered.pins[0]!.releaseId
      assert.equal((await q.queryRow<RowDataPacket>('SELECT COUNT(*) AS n FROM platform_app_releases WHERE status=\'released\' AND id=?', [baselineID]))!.n, 0, 'all legacy status-only global latest selectors exclude baselines')
      await conn.beginTransaction()
      await conn.query('UPDATE platform_app_manifests SET manifest_hash=\'drift\' WHERE id=1')
      await assert.rejects(loadEnvironmentAppSelection(q, 'T', 'prod', { pins: registered.pins, sourceBundleId: 40 }), { statusCode: 409 })
      await assert.rejects(planMigrationBaselines(q, { tenant: 'T', environment: 'prod', bundleId: 40 }).then(p => registerMigrationBaselines(q, { tenant: 'T', environment: 'prod', bundleId: 40, reviewHash: plan.reviewHash, actor: 'fixture-admin', reason: p.reviewHash })), { statusCode: 409 })
      await conn.rollback()
      await assert.rejects(conn.query('UPDATE platform_app_releases SET status=\'released\' WHERE id=?', [baselineID]), 'DB constraint rejects baseline promotion')
      await assert.rejects(conn.query('UPDATE platform_app_releases SET source_tag=\'fake-tag\' WHERE id=?', [baselineID]))
      await assert.rejects(loadEnvironmentAppSelection(q, 'T', 'test', { pins: registered.pins, sourceBundleId: null }), { statusCode: 409 })
      await conn.beginTransaction()
      await assert.rejects(registerMigrationBaselines(q, { tenant: 'T', environment: 'prod', bundleId: 40, reviewHash: 'bad', actor: 'fixture-admin', reason: 'stale' }), { statusCode: 409 })
      await conn.rollback()
    } finally { await conn.end() }
  }, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
  assert.equal(executed, true)
})
