import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { expectedG9Tables, migrateG9Schema, restoreG9Dump, schemaInventory } from './g9-platform-schema.mjs'
import { applyG9Data, planG9Data, readG9Data, rollbackG9Data, verifyG9Data } from './g9-platform-data.mjs'
import { planG9Sanitize, sanitizeG9Clone } from './g9-platform-sanitize.mjs'
import { checkG9Orphans } from './g9-orphan-gate.mjs'
import { buildG9OfficialTrustPlan } from './g9-official-trust-plan.mjs'
import { applyCollabDeployment, planCollabDeployment, readCollabDeploymentState, rollbackCollabDeployment, verifyCollabDeployment } from './g9-collab-deployment.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  const sourceConfig = context.connection('console')
  const targetConfig = context.connection('aims')
  const rollbackConfig = context.connection('altoc')
  const source = await mysql.createConnection({ ...sourceConfig, multipleStatements: true, dateStrings: true })
  const target = await mysql.createConnection({ ...targetConfig, multipleStatements: true, dateStrings: true })
  const dir = mkdtempSync(join(tmpdir(), 'g9-synthetic-'))
  try {
    await source.query(`
      CREATE TABLE tenants (tenant_code VARCHAR(64) PRIMARY KEY,status VARCHAR(32),updated_at DATETIME NULL);
      CREATE TABLE platform_accounts (id BIGINT PRIMARY KEY,uid VARCHAR(64) UNIQUE,status VARCHAR(32),updated_at DATETIME NULL);
      CREATE TABLE tenant_roles (id BIGINT UNSIGNED PRIMARY KEY,tenant_code VARCHAR(64),UNIQUE KEY(id,tenant_code));
      CREATE TABLE tenant_subscriptions (id BIGINT PRIMARY KEY,tenant_code VARCHAR(64),status VARCHAR(32),ended_at DATETIME NULL,updated_at DATETIME NULL,plan_code VARCHAR(64) NULL,started_at DATETIME NULL);
      CREATE TABLE subscriptions (id BIGINT PRIMARY KEY AUTO_INCREMENT,tenant_code VARCHAR(64),status VARCHAR(32),ended_at DATETIME NULL,updated_at DATETIME NULL,subscription_no VARCHAR(64) NULL,tenant_subscription_id BIGINT NULL,app_code VARCHAR(64) NULL,plan_code VARCHAR(64) NULL,source VARCHAR(32) NULL,started_at DATETIME NULL);
      CREATE TABLE deployment_sites (id BIGINT UNSIGNED PRIMARY KEY,tenant_code VARCHAR(64),site_code VARCHAR(128),environment VARCHAR(32),status VARCHAR(32),public_url VARCHAR(255),root_app_code VARCHAR(64),updated_at DATETIME NULL);
      CREATE TABLE deployments (id BIGINT PRIMARY KEY AUTO_INCREMENT,tenant_code VARCHAR(64),deployment_code VARCHAR(128),environment VARCHAR(32),app_code VARCHAR(64),status VARCHAR(32),site_id BIGINT NULL,base_path VARCHAR(128) NULL,api_base VARCHAR(128) NULL,route_source VARCHAR(32) DEFAULT 'default',updated_at DATETIME NULL,subscription_id BIGINT NULL,deployment_name VARCHAR(255) NULL,deployment_mode VARCHAR(64) NULL,region VARCHAR(64) NULL,license_status VARCHAR(32) NULL,connectivity_status VARCHAR(32) NULL);
      CREATE TABLE platform_applications (app_code VARCHAR(64) PRIMARY KEY,status VARCHAR(32),manifest_path VARCHAR(255) NULL,release_tag_prefix VARCHAR(64) NULL);
      CREATE TABLE tenant_runtime_instances (id BIGINT PRIMARY KEY,tenant_code VARCHAR(64),runtime_code VARCHAR(128),status VARCHAR(32),runtime_endpoint VARCHAR(255),runtime_token_hash VARCHAR(128),runtime_token_last4 VARCHAR(8),control_token_hash VARCHAR(128),control_token_last4 VARCHAR(8),enrolled_at DATETIME NULL,last_heartbeat_at DATETIME NULL,updated_at DATETIME NULL);
      CREATE TABLE tenant_runtime_credentials (tenant_code VARCHAR(64) PRIMARY KEY,status VARCHAR(32),revoked_at DATETIME NULL,updated_at DATETIME NULL);
      CREATE TABLE deployment_bootstrap_secrets (id BIGINT PRIMARY KEY,tenant_code VARCHAR(64),app_code VARCHAR(64),secret_code VARCHAR(128),status VARCHAR(32),updated_at DATETIME NULL);
      CREATE TABLE platform_signing_keys (id BIGINT PRIMARY KEY,kid VARCHAR(64),status VARCHAR(32),revoked_at DATETIME NULL,rotated_at DATETIME NULL,updated_at DATETIME NULL);
      CREATE TABLE tenant_role_permissions (id BIGINT PRIMARY KEY,tenant_code VARCHAR(64),app_code VARCHAR(64),resource_code VARCHAR(128));
      CREATE TABLE tenant_role_scopes (id BIGINT PRIMARY KEY,tenant_code VARCHAR(64),app_code VARCHAR(64),resource_code VARCHAR(128));
      CREATE TABLE platform_app_role_permissions (id BIGINT PRIMARY KEY,app_code VARCHAR(64),resource_code VARCHAR(128));
      CREATE TABLE platform_sessions (id BIGINT PRIMARY KEY,secret VARCHAR(64));
      INSERT INTO tenants VALUES ('C000001','active',NULL),('C000002','active',NULL);
      INSERT INTO platform_accounts VALUES (1,'gavin,zhouguangying','active',NULL),(2,'normal','active',NULL);
      INSERT INTO tenant_roles VALUES (1,'C000001');
      INSERT INTO tenant_subscriptions (id,tenant_code,status,ended_at,plan_code,started_at) VALUES (1,'C000001','active','2026-06-14','enterprise-full','2026-01-01');
      INSERT INTO subscriptions (id,tenant_code,status,ended_at,subscription_no,tenant_subscription_id,app_code,plan_code) VALUES (1,'C000001','active','2026-06-14','SUB-CONSOLE',1,'console','enterprise-full');
      INSERT INTO platform_applications VALUES ('collab','active','collab/app.manifest.json','collab/'),('console','active','console/app.manifest.json','console/');
      INSERT INTO deployment_sites VALUES (1,'C000001','C000001-main','prod','active','https://old.invalid','console',NULL),(2,'C000001','C000001-test','test','active','https://test.invalid','enterprise',NULL),(3,'C000002','C000002-main','prod','active','https://localhost.invalid','console',NULL);
      INSERT INTO deployments (id,tenant_code,deployment_code,environment,app_code,status,site_id,base_path,api_base,updated_at,subscription_id,deployment_mode,region) VALUES (1,'C000001','C000001-console','prod','console','active',NULL,NULL,NULL,NULL,1,'customer-hosted','cn-fixture'),(2,'C000001','C000001-finance','prod','finance','active',1,NULL,NULL,NULL,1,'customer-hosted',NULL),(3,'C000001','C000001-test-aims','test','aims','active',2,NULL,NULL,NULL,1,'customer-hosted',NULL);
      INSERT INTO tenant_runtime_instances VALUES (1,'C000001','c000001-prod-tenant-runtime','ready','https://old.invalid','fixture-hash','1234','fixture-control','5678',NOW(),NOW(),NULL);
      INSERT INTO tenant_runtime_credentials VALUES ('C000001','active',NULL,NULL);
      INSERT INTO deployment_bootstrap_secrets VALUES (1,'C000001','console','console.vault.master_key','migrated',NULL),(2,'C000001','console','data-runtime.static_token','active',NULL),(3,'C000001','aims','data-runtime.static_token','active',NULL);
      INSERT INTO platform_signing_keys VALUES (1,'old-kid','active',NULL,NULL,NULL);
      INSERT INTO platform_sessions VALUES (1,'synthetic-session');
    `)
    const dump = spawnSync('mysqldump', ['--no-defaults', '--host=127.0.0.1', `--port=${sourceConfig.port}`,
      `--user=${sourceConfig.user}`, '--single-transaction', '--no-tablespaces', sourceConfig.database],
    { env: { ...process.env, MYSQL_PWD: sourceConfig.password }, encoding: 'utf8' })
    assert.equal(dump.status, 0, dump.stderr)
    const dumpPath = join(dir, 'synthetic.sql')
    writeFileSync(dumpPath, dump.stdout, { mode: 0o600 })
    chmodSync(dumpPath, 0o600)
    const restored = await restoreG9Dump({ db: targetConfig, dumpPath })
    assert.match(restored.dumpSha256, /^[a-f0-9]{64}$/)
    const unsafeDump = join(dir, 'unsafe.sql')
    writeFileSync(unsafeDump, 'USE `unexpected_database`;\n', { mode: 0o600 })
    await assert.rejects(restoreG9Dump({ db: targetConfig, dumpPath: unsafeDump }), /G9_DUMP_MUST_NOT_SELECT_DATABASE/)
    assert.equal((await target.query('SELECT COUNT(*) AS n FROM tenants'))[0][0].n, 2)
    const migrated = await migrateG9Schema(target)
    assert.equal(migrated.applied.length, 13)
    assert.equal((await migrateG9Schema(target)).applied.length, 0)
    assert.equal(expectedG9Tables().length, 18)
    assert.equal((await schemaInventory(target)).tables.length, 16 + 18)
    const generationSchema = await schemaInventory(target)
    const generationColumns = generationSchema.columns.filter(row => row.tableName === 'enterprise_external_drain_approvals')
    assert.equal(generationColumns.find(row => row.name === 'target_generation')?.nullable, 'NO')
    assert.equal(generationColumns.find(row => row.name === 'artifact_json')?.type.toLowerCase(), 'json')
    const generationIndex = generationSchema.indexes.filter(row => row.tableName === 'enterprise_external_drain_approvals' && row.name === 'uk_external_drain_generation')
    assert.deepEqual(generationIndex.map(row => row.columnName), ['tenant_code', 'environment', 'cutover_key', 'target_generation'])
    assert.ok(generationIndex.every(row => Number(row.nonUnique) === 0))
    const approval = (revision, requestId) => target.execute(`INSERT INTO enterprise_external_drain_approvals
      (tenant_code,environment,cutover_key,target_generation,seal_revision,seal_payload_sha256,request_id,payload_sha256,payload_json,artifact_json,actor_uid,approval_reference)
      VALUES('C000001','prod','g9-fixture','7',?,? ,?,?,'{}','{}','operator','fixture')`,
    [revision, 'a'.repeat(64), requestId, 'b'.repeat(64)])
    await approval(1, 'g9-review-1')
    await assert.rejects(approval(2, 'g9-review-2'), /Duplicate entry/)

    const sanitizePlan = await planG9Sanitize(target)
    assert.deepEqual(sanitizePlan, { platform_sessions: 1 })
    await assert.rejects(sanitizeG9Clone(target, sanitizePlan, async () => {
      throw Error('synthetic_abort')
    }), /synthetic_abort/)
    assert.equal((await target.query('SELECT COUNT(*) AS n FROM platform_sessions'))[0][0].n, 1)
    assert.deepEqual(await sanitizeG9Clone(target, sanitizePlan), { platform_sessions: 1 })
    assert.equal((await target.query('SELECT COUNT(*) AS n FROM platform_sessions'))[0][0].n, 0)

    assert.deepEqual(await checkG9Orphans(target), { pairs: 74, orphanRows: 0 })
    await target.query('INSERT INTO tenant_role_permissions VALUES (1,\'C000001\',\'aims\',\'project-edit\')')
    await assert.rejects(checkG9Orphans(target), /G9_ORPHAN_RESOURCES_PRESENT/)
    await target.query('DELETE FROM tenant_role_permissions')

    const options = { runtimeEndpoint: 'https://aidcp-runtime.wiztek.cn', revokedAt: '2026-09-29 00:00:00', oldSigningKids: ['old-kid'] }
    const initial = planG9Data(await readG9Data(target), options)
    assert.ok(initial.operations.length > 10)
    await assert.rejects(applyG9Data(target, options, initial.reviewHash, null,
      db => db.query('UPDATE platform_accounts SET status=\'disabled\' WHERE uid=\'normal\'')), /G9_NON_TARGET_CHANGED/)
    assert.equal((await target.query('SELECT status FROM platform_accounts WHERE uid=\'normal\''))[0][0].status, 'active')
    const receipt = await applyG9Data(target, options, initial.reviewHash)
    verifyG9Data(await readG9Data(target), options)

    // Collab deployment registration (user decision 2026-09-29): plan -> apply -> verify -> rollback.
    const collabOptions = { tenant: 'C000001' }
    const collabState = () => readCollabDeploymentState(target)
    const collabPlan = planCollabDeployment(await collabState(), collabOptions)
    assert.deepEqual(collabPlan.operations.map(op => op.kind), ['insert-subscription', 'insert-deployment'])
    assert.equal(collabPlan.deploymentCode, 'C000001-collab')
    assert.equal(collabPlan.operations[1].row.base_path, '/collab/')
    assert.equal(collabPlan.operations[1].row.api_base, '/api/v1/collab')
    assert.equal(collabPlan.operations[1].row.deployment_mode, 'customer-hosted')
    await assert.rejects(applyCollabDeployment(target, collabOptions, 'f'.repeat(64)), /G9_COLLAB_REVIEW_HASH_CHANGED/)
    await assert.rejects(applyCollabDeployment(target, collabOptions, collabPlan.reviewHash, null,
      db => db.query('UPDATE platform_accounts SET status=\'disabled\' WHERE uid=\'normal\'; UPDATE deployments SET status=\'inactive\' WHERE deployment_code=\'C000001-console\'')), /G9_COLLAB_NON_TARGET_CHANGED/)
    assert.equal((await target.query('SELECT COUNT(*) AS n FROM deployments WHERE app_code=\'collab\''))[0][0].n, 0)
    assert.equal((await target.query('SELECT status FROM deployments WHERE deployment_code=\'C000001-console\''))[0][0].status, 'active')
    const collabReceipt = await applyCollabDeployment(target, collabOptions, collabPlan.reviewHash)
    const [[collabRow]] = await target.query('SELECT d.*, s.subscription_no FROM deployments d JOIN subscriptions s ON s.id=d.subscription_id WHERE d.deployment_code=\'C000001-collab\'')
    assert.deepEqual([collabRow.app_code, collabRow.status, collabRow.base_path, collabRow.api_base, collabRow.route_source, collabRow.license_status, collabRow.subscription_no],
      ['collab', 'active', '/collab/', '/api/v1/collab', 'platform_override', 'pending', 'G9-COLLAB-C000001'])
    assert.equal(String(collabRow.site_id), String((await target.query('SELECT id FROM deployment_sites WHERE site_code=\'C000001-main\''))[0][0].id))
    verifyCollabDeployment(await collabState(), collabOptions)
    assert.equal(planCollabDeployment(await collabState(), collabOptions).operations.length, 0)
    // The base G-9 cleanup plan is unaffected by the registered collab rows.
    assert.equal(planG9Data(await readG9Data(target), { ...options, oldSigningKids: [] }).operations.length, 0)
    await target.query('UPDATE deployments SET base_path=\'/drift/\' WHERE deployment_code=\'C000001-collab\'')
    await assert.rejects(rollbackCollabDeployment(target, collabReceipt), /G9_COLLAB_ROLLBACK_TARGET_CHANGED/)
    await target.query('UPDATE deployments SET base_path=\'/collab/\' WHERE deployment_code=\'C000001-collab\'')
    assert.deepEqual(await rollbackCollabDeployment(target, collabReceipt), { restored: true })
    assert.equal((await target.query('SELECT COUNT(*) AS n FROM deployments WHERE app_code=\'collab\''))[0][0].n, 0)
    assert.equal((await target.query('SELECT COUNT(*) AS n FROM subscriptions WHERE app_code=\'collab\''))[0][0].n, 0)
    assert.equal(planCollabDeployment(await collabState(), collabOptions).reviewHash, collabPlan.reviewHash)
    // Existing (inactive, unrouted) row: converted in place, restored on rollback; foreign codes and route clashes stop.
    await target.query('INSERT INTO subscriptions (tenant_code,status,subscription_no,tenant_subscription_id,app_code,plan_code) VALUES (\'C000001\',\'active\',\'PRE-COLLAB\',1,\'collab\',\'enterprise-full\')')
    await target.query('INSERT INTO deployments (tenant_code,deployment_code,environment,app_code,status,subscription_id,deployment_mode) SELECT \'C000001\',\'C000001-collab\',\'prod\',\'collab\',\'inactive\',id,\'customer-hosted\' FROM subscriptions WHERE subscription_no=\'PRE-COLLAB\'')
    const updatePlan = planCollabDeployment(await collabState(), collabOptions)
    assert.deepEqual(updatePlan.operations.map(op => op.kind), ['update-deployment'])
    const updateReceipt = await applyCollabDeployment(target, collabOptions, updatePlan.reviewHash)
    verifyCollabDeployment(await collabState(), collabOptions)
    await rollbackCollabDeployment(target, updateReceipt)
    assert.deepEqual((await target.query('SELECT status,site_id,base_path FROM deployments WHERE deployment_code=\'C000001-collab\''))[0][0], { status: 'inactive', site_id: null, base_path: null })
    await target.query('UPDATE deployments SET deployment_code=\'C000001-collab-old\' WHERE deployment_code=\'C000001-collab\'')
    const foreignState = await collabState()
    assert.throws(() => planCollabDeployment(foreignState, collabOptions), /G9_COLLAB_FOREIGN_DEPLOYMENT_CODE/)
    await target.query('DELETE FROM deployments WHERE app_code=\'collab\'; DELETE FROM subscriptions WHERE app_code=\'collab\'')

    const postOptions = { ...options, oldSigningKids: [] }
    assert.equal(planG9Data(await readG9Data(target), postOptions).operations.length, 0)
    await applyG9Data(target, postOptions, planG9Data(await readG9Data(target), postOptions).reviewHash)
    await target.query('UPDATE platform_accounts SET status=\'disabled\' WHERE uid=\'normal\'')
    await assert.rejects(rollbackG9Data(target, receipt), /G9_ROLLBACK_NON_TARGET_CHANGED/)
    await target.query('UPDATE platform_accounts SET status=\'active\' WHERE uid=\'normal\'')
    assert.equal((await rollbackG9Data(target, receipt)).restored, initial.operations.length)
    assert.equal(planG9Data(await readG9Data(target), options).reviewHash, initial.reviewHash)
    await restoreG9Dump({ db: rollbackConfig, dumpPath })
    const rollbackClone = await mysql.createConnection({ ...rollbackConfig, dateStrings: true, multipleStatements: true })
    try {
      assert.equal((await rollbackClone.query('SELECT status FROM platform_signing_keys WHERE kid=\'old-kid\''))[0][0].status, 'active')
      assert.equal((await rollbackClone.query('SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=\'tenant_enterprise_entitlements\''))[0][0].n, 0)
      await rollbackClone.query('CREATE TABLE tenant_enterprise_entitlements (tenant_code VARCHAR(64) PRIMARY KEY)')
      await assert.rejects(migrateG9Schema(rollbackClone), /G9_PARTIAL_MIGRATION/)
    } finally { await rollbackClone.end() }
    const trust = buildG9OfficialTrustPlan({ runtimeEndpoint: options.runtimeEndpoint, signingKid: 'synthetic-kid' })
    assert.equal(trust.stages.length, 9)
    assert.ok(trust.stages.every(stage => !JSON.stringify(stage).includes('privateKey')))
    assert.equal(readFileSync(dumpPath, 'utf8').includes('synthetic-session'), true)
    await target.query('ALTER TABLE tenant_reserved_subdomains DROP INDEX uk_tenant_reserved_subdomains_subdomain')
    await assert.rejects(migrateG9Schema(target), /G9_PARTIAL_MIGRATION:.*tenant_reserved_subdomains/)
    await target.query('ALTER TABLE tenant_reserved_subdomains ADD UNIQUE KEY uk_tenant_reserved_subdomains_subdomain(subdomain)')
    await target.query('ALTER TABLE enterprise_external_drain_approvals DROP INDEX uk_external_drain_generation')
    await assert.rejects(migrateG9Schema(target), /G9_PARTIAL_MIGRATION:external-drain-generation/)
    console.log('G9 isolated MySQL: local dump restore, 13 migrations/18 tables, generation columns/unique index/partial install, inventory, sanitize rollback, 74-pair gate, reviewHash/apply/idempotence/non-target drift/rollback + collab deployment plan/apply/verify/update/rollback PASS')
  } finally {
    await source.end()
    await target.end()
  }
}, { execute: true, confirm: plan.confirmationSha256 })
