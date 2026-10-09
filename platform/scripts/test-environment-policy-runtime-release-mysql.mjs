import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { createError } from 'h3'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { registerEnterpriseNuxtTestHost } from './support/enterprise-nuxt-test-host.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
globalThis.createError = createError
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  globalThis.useRuntimeConfig = () => ({ db: { ...context.connection('console'), name: context.connection('console').database } })
  const pool = mysql.createPool({ ...context.connection('console'), multipleStatements: true, dateStrings: true, connectionLimit: 1 })
  const db = await pool.getConnection()
  // mysql2 lazily loads its protocol modules on first connect; register the
  // Nuxt test host only afterwards (same order as the sibling MySQL scripts).
  registerEnterpriseNuxtTestHost(rootDir)
  const { resolveTenantEnvironmentPolicyRevision } = await import('../server/utils/environmentPolicyRevision.ts')
  const { approveDataRuntimeRelease } = await import('../server/utils/dataRuntimeReleaseRegistry.ts')
  const { useDbPool } = await import('../server/utils/db.ts')
  try {
    await db.query(`CREATE TABLE tenants(tenant_code VARCHAR(64) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      CREATE TABLE tenant_policy_revisions(tenant_code VARCHAR(64),policy_revision BIGINT,policy_hash VARCHAR(96),policy_updated_at DATETIME);
      CREATE TABLE policy_bundles(id BIGINT PRIMARY KEY,tenant_code VARCHAR(64),environment VARCHAR(32),policy_revision BIGINT,policy_hash VARCHAR(96));
      CREATE TABLE tenant_runtime_instances(id BIGINT PRIMARY KEY,environment VARCHAR(32),release_signing_key_id VARCHAR(64),desired_version VARCHAR(32),current_version VARCHAR(32),updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE platform_runtime_releases(id BIGINT PRIMARY KEY,runtime_code VARCHAR(64),release_version VARCHAR(32),release_signing_key_id VARCHAR(64),status VARCHAR(32));
      CREATE TABLE platform_runtime_release_channels(runtime_code VARCHAR(64),channel_code VARCHAR(64),approved_release_id BIGINT,approval_kind VARCHAR(32),approved_by_account_id BIGINT,approved_at DATETIME,approval_note TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(runtime_code,channel_code));
      CREATE TABLE platform_audit_logs(operator_account_id BIGINT,target_type VARCHAR(64),target_id VARCHAR(128),target_tenant_code VARCHAR(64),action VARCHAR(64),before_json JSON,after_json JSON,source VARCHAR(64),ip VARCHAR(64),user_agent TEXT,created_at DATETIME);
      INSERT INTO tenants VALUES('T');
      INSERT INTO tenant_policy_revisions VALUES('T',38,'prod38',UTC_TIMESTAMP());
      INSERT INTO policy_bundles VALUES(1,'T','prod',38,'prod38'),(2,'T','test',37,'test37');
      INSERT INTO tenant_runtime_instances(id,environment,release_signing_key_id,desired_version,current_version) VALUES(1,'prod','key','1.0.0','1.0.0'),(2,'test','key','1.0.0','1.0.0'),(3,'test','key','1.0.0','1.0.0'),(4,'test','key','1.0.0','1.0.0');
      INSERT INTO platform_runtime_releases VALUES(1,'hzy-data-runtime','1.0.0','key','available'),(2,'hzy-data-runtime','2.0.0','key','available');`)
    const sql = name => readFileSync(new URL(`../docs/sql/migrations/20261002-environment-policy-runtime-release${name}.sql`, import.meta.url), 'utf8')
    await db.query(sql(''))
    await db.beginTransaction()
    await db.query(sql('-backfill'))
    await db.commit()
    const tx = { queryRow: async (s, p) => (await db.execute(s, p))[0][0] || null, execute: async (s, p) => (await db.execute(s, p))[0] }
    await db.beginTransaction()
    assert.equal(await resolveTenantEnvironmentPolicyRevision(tx, 'T', 'prod38', 'prod'), 38)
    assert.equal(await resolveTenantEnvironmentPolicyRevision(tx, 'T', 'new-test', 'test'), 39)
    await db.execute('INSERT INTO policy_bundles VALUES(3,\'T\',\'test\',39,\'new-test\')')
    await db.commit()
    const [[prod]] = await db.query('SELECT policy_revision FROM tenant_environment_policy_revisions WHERE environment=\'prod\'')
    assert.equal(prod.policy_revision, 38)
    await db.query('UPDATE tenant_runtime_instances SET release_update_mode=\'tracking\' WHERE id IN(1,2); UPDATE tenant_runtime_instances SET release_update_mode=\'retired\' WHERE id=4')
    const [before] = await db.query('SELECT * FROM tenant_runtime_instances WHERE id<>2 ORDER BY id')
    const input = { environment: 'test', version: '2.0.0', releaseSigningKeyId: 'key', accountId: 1, ip: null, userAgent: null, note: 'isolated', confirmRollback: false, compareVersions: (a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]) }
    assert.equal((await approveDataRuntimeRelease(input)).updatedInstances, 1)
    assert.deepEqual((await db.query('SELECT * FROM tenant_runtime_instances WHERE id<>2 ORDER BY id'))[0], before)
    await assert.rejects(approveDataRuntimeRelease({ ...input, version: '1.0.0' }), { statusCode: 409 })
    const [[test]] = await db.query('SELECT desired_version FROM tenant_runtime_instances WHERE id=2')
    assert.equal(test.desired_version, '2.0.0')
    assert.equal((await approveDataRuntimeRelease({ ...input, version: '1.0.0', confirmRollback: true })).approvalKind, 'rollback')
    assert.equal((await approveDataRuntimeRelease({ ...input, environment: 'prod' })).updatedInstances, 1)
    const [[testAfterProd]] = await db.query('SELECT desired_version FROM tenant_runtime_instances WHERE id=2')
    assert.equal(testAfterProd.desired_version, '1.0.0')
    const [results] = await db.query(sql('-verify'))
    for (const rows of results.slice(0, 4)) assert.deepEqual(rows, [])
    assert.equal(results[4][0].release_mode_column, 'PASS')
    // Isolated schema rollback, not a live-approval rollback. Existing data survives.
    await db.query('ALTER TABLE tenant_runtime_instances DROP COLUMN release_update_mode; DROP TABLE tenant_environment_policy_revisions')
    assert.equal((await db.query('SELECT COUNT(*) n FROM tenant_runtime_instances'))[0][0].n, 4)
    console.log('PASS: actual migration/backfill + prod38 unchanged/test39; actual approval environment/mode isolation + rollback fence')
  } finally {
    db.release()
    await pool.end()
    await useDbPool().end()
  }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
