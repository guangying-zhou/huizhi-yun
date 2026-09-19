import assert from 'node:assert/strict'
import { testEnterpriseOrdersWithNuxtHost } from './support/enterprise-order-e2e.mjs'
import { testEnterprisePolicyBoundary } from './support/enterprise-policy-e2e.mjs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { loadBundleEnterpriseEntitlement, bundleEnterpriseEntitlementMatches } from '../server/utils/enterpriseEntitlementBundle.ts'
import { createEnterpriseEntitlementStateRepository } from '../server/utils/enterpriseEntitlementState.ts'
import { createEnterpriseEntitlementRepository } from '../server/utils/enterpriseEntitlementRepository.ts'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  const pool = mysql.createPool({ ...context.connection('console'), timezone: 'Z', dateStrings: true, multipleStatements: true })
  try {
    await pool.query(`
      CREATE TABLE tenants (tenant_code VARCHAR(64) PRIMARY KEY, status VARCHAR(32)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      CREATE TABLE tenant_subscriptions (id BIGINT PRIMARY KEY, tenant_code VARCHAR(64), status VARCHAR(32), started_at DATETIME, ended_at DATETIME, current_order_id BIGINT, plan_code VARCHAR(64), updated_at DATETIME, KEY(tenant_code));
      CREATE TABLE subscriptions (id BIGINT PRIMARY KEY, tenant_code VARCHAR(64), tenant_subscription_id BIGINT, app_code VARCHAR(64), status VARCHAR(32), started_at DATETIME, ended_at DATETIME, current_order_id BIGINT, plan_code VARCHAR(64), updated_at DATETIME, KEY(tenant_code));
      CREATE TABLE platform_orders (id BIGINT PRIMARY KEY, order_no VARCHAR(128), payment_method VARCHAR(32), total_amount DECIMAL(12,2), currency VARCHAR(8), tenant_code VARCHAR(64), status VARCHAR(32), effective_from DATETIME, effective_until DATETIME, paid_at DATETIME, plan_code VARCHAR(64), updated_at DATETIME, KEY(tenant_code));
      CREATE TABLE platform_payments (id BIGINT PRIMARY KEY AUTO_INCREMENT, payment_no VARCHAR(128) UNIQUE, order_id BIGINT, invoice_id BIGINT NULL, tenant_code VARCHAR(64), amount DECIMAL(12,2), currency VARCHAR(8), method VARCHAR(32), status VARCHAR(32), transaction_ref VARCHAR(128), paid_at DATETIME, confirmed_by_account_id BIGINT, confirmed_at DATETIME, created_at DATETIME);
      CREATE TABLE licenses (id BIGINT PRIMARY KEY, tenant_code VARCHAR(64), subscription_id BIGINT, status VARCHAR(32), issued_at DATETIME, expires_at DATETIME, grace_until DATETIME, payload_hash VARCHAR(128), updated_at DATETIME, KEY(tenant_code));
      CREATE TABLE license_deployments (id BIGINT PRIMARY KEY, license_id BIGINT, deployment_id BIGINT, status VARCHAR(32), effective_from DATETIME, effective_until DATETIME);
      INSERT INTO tenants VALUES ('t1','active'),('t2','active'),('t3','active');
      INSERT INTO tenant_subscriptions VALUES (1,'t1','active','2026-01-01','2027-01-01',NULL,'legacy','2026-01-01'),(2,'t2','active','2026-01-01','2027-01-01',NULL,'legacy','2026-01-01'),(3,'t3','active','2026-01-01','2027-01-01',NULL,'legacy','2026-01-01');
    `)
    await pool.query(await readFile(resolve(rootDir, 'platform/docs/sql/migrations/20260913-enterprise-entitlements.sql'), 'utf8'))
    await pool.query(await readFile(resolve(rootDir, 'platform/docs/sql/migrations/20260913-enterprise-entitlement-state.sql'), 'utf8'))
    await pool.query(await readFile(resolve(rootDir, 'platform/docs/sql/migrations/20260913-enterprise-order-fulfillments.sql'), 'utf8'))
    await pool.query(await readFile(resolve(rootDir, 'platform/docs/sql/migrations/20260913-enterprise-order-approvals.sql'), 'utf8'))
    const withTransaction = async (work) => {
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const value = await work({
          queryRows: async (sql, params) => (await connection.query(sql, params))[0],
          queryRow: async (sql, params) => (await connection.query(sql, params))[0][0] || null,
          execute: async (sql, params) => (await connection.execute(sql, params))[0]
        })
        await connection.commit()
        return value
      } catch (error) {
        await connection.rollback()
        throw error
      } finally { connection.release() }
    }
    const repo = createEnterpriseEntitlementRepository(withTransaction)
    const now = '2026-09-13T00:00:00Z'
    const request = { tenantCode: 't1', migrationId: 'mysql-m1' }
    const before = JSON.stringify((await pool.query('SELECT * FROM tenant_subscriptions ORDER BY id'))[0])
    const preview = await repo.convert(request, now)
    assert.equal(preview.result.decision, 'ready')
    const apply = { ...request, mode: 'apply', expectedRevision: 0, sourceHash: preview.result.sourceHash }
    const concurrent = await Promise.all([repo.convert(apply, now), repo.convert(apply, now)])
    assert.equal(concurrent.filter(r => r.replayed).length, 1)
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM tenant_enterprise_entitlements'))[0][0].n), 1)
    await assert.rejects(repo.convert({ ...apply, sourceHash: 'different' }, now), /migration_id_payload_conflict/)
    const preview2 = await repo.convert({ tenantCode: 't2', migrationId: 'mysql-m2' }, now)
    await pool.query('UPDATE tenant_subscriptions SET ended_at=\'2028-01-01\' WHERE tenant_code=\'t2\'')
    await assert.rejects(repo.convert({ tenantCode: 't2', migrationId: 'mysql-m2', mode: 'apply', expectedRevision: 0, sourceHash: preview2.result.sourceHash }, now), /entitlement_migration_conflict/)
    await pool.query('UPDATE tenant_subscriptions SET ended_at=\'2027-01-01\' WHERE tenant_code=\'t2\'')
    const preview3 = await repo.convert({ tenantCode: 't3', migrationId: 'mysql-m3' }, now)
    await pool.query('CREATE TRIGGER fail_entitlement_receipt BEFORE INSERT ON tenant_enterprise_entitlement_migrations FOR EACH ROW SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT = \'fixture_receipt_failure\'')
    await assert.rejects(repo.convert({ tenantCode: 't3', migrationId: 'mysql-m3', mode: 'apply', expectedRevision: 0, sourceHash: preview3.result.sourceHash }, now), /fixture_receipt_failure/)
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM tenant_enterprise_entitlements WHERE tenant_code=\'t3\''))[0][0].n), 0)
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM tenant_enterprise_entitlement_current WHERE tenant_code=\'t3\''))[0][0].n), 0)
    assert.equal(JSON.stringify((await pool.query('SELECT * FROM tenant_subscriptions ORDER BY id'))[0]), before)
    const queryQualification = async (sql, params) => (await pool.query(sql, params))[0][0] || null
    const beforeState = await loadBundleEnterpriseEntitlement(queryQualification, 't1', 'active', now)
    assert.equal(beforeState.revision, 1)
    assert.equal(await loadBundleEnterpriseEntitlement(queryQualification, 't2', 'active', now), null)
    const states = createEnterpriseEntitlementStateRepository(withTransaction)
    const suspend = { tenantCode: 't1', operationId: 'suspend-1', expectedRevision: 1, action: 'suspend', actorUid: 'ops-1', reason: 'fixture suspension' }
    const stateResults = await Promise.all([states.change(suspend, now), states.change(suspend, now)])
    assert.equal(stateResults.filter(result => result.replayed).length, 1)
    assert.equal(stateResults[0].entitlement.status, 'suspended')
    await assert.rejects(states.change({ ...suspend, reason: 'different' }, now), /entitlement_state_operation_conflict/)
    await pool.query('CREATE TRIGGER fail_state_receipt BEFORE INSERT ON tenant_enterprise_entitlement_state_commands FOR EACH ROW SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT = \'fixture_state_receipt_failure\'')
    const restore = { ...suspend, action: 'restore', operationId: 'restore-1', expectedRevision: 2 }
    await assert.rejects(states.change(restore, now), /fixture_state_receipt_failure/)
    assert.equal(Number((await pool.query('SELECT revision FROM tenant_enterprise_entitlement_current WHERE tenant_code=\'t1\''))[0][0].revision), 2)
    await pool.query('DROP TRIGGER fail_state_receipt')
    await pool.query('UPDATE tenants SET status=\'suspended\' WHERE tenant_code=\'t1\'')
    await assert.rejects(states.change(restore, now), /enterprise_tenant_not_active/)
    await pool.query('UPDATE tenants SET status=\'active\' WHERE tenant_code=\'t1\'')
    const restored = await states.change(restore, now)
    assert.equal(restored.entitlement.status, 'active')
    assert.deepEqual(restored.entitlement.end, stateResults[0].entitlement.end)
    const revoke = { ...suspend, action: 'revoke', operationId: 'revoke-1', expectedRevision: 3 }
    assert.equal((await states.change(revoke, now)).entitlement.status, 'revoked')
    const revokedQualification = await loadBundleEnterpriseEntitlement(queryQualification, 't1', 'active', now)
    assert.equal(revokedQualification.revision, 4)
    assert.equal(revokedQualification.effectiveStatus, 'revoked')
    assert.equal(bundleEnterpriseEntitlementMatches({ enterpriseEntitlement: beforeState }, revokedQualification), false)
    await assert.rejects(states.change({ ...restore, operationId: 'restore-2', expectedRevision: 4 }, now), /entitlement_revoked/)
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM tenant_enterprise_entitlements WHERE tenant_code=\'t2\''))[0][0].n), 0)
    assert.equal(JSON.stringify((await pool.query('SELECT * FROM tenant_subscriptions ORDER BY id'))[0]), before)
    await pool.query('DROP TRIGGER fail_entitlement_receipt')
    if (process.argv.includes('--orders-only')) await testEnterpriseOrdersWithNuxtHost({ rootDir, context, pool, withTransaction })
    else await testEnterprisePolicyBoundary({ rootDir, context, pool, withTransaction })
    console.log('Enterprise entitlement MySQL: state transitions, actor receipts, tenant isolation,  schema, concurrent replay, drift, rollback and legacy preservation passed.')
  } finally { await pool.end() }
}, { execute: true, confirm: plan.confirmationSha256 })
