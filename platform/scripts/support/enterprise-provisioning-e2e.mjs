import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { composeManifest } from '../../../enterprise/scripts/manifest-artifacts.mjs'
import { createHash, verify } from 'node:crypto'
import { createEnterpriseOrderFulfillmentRepository } from '../../server/utils/enterpriseOrderFulfillment.ts'
import { createEnterpriseEntitlementStateRepository } from '../../server/utils/enterpriseEntitlementState.ts'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

/** Executes actual onboarding in the caller's dedicated disposable MySQL instance. */
export async function testEnterpriseProvisioning({ rootDir, pool, withTransaction, publicKey }) {
  const ddl = await readFile(`${rootDir}/platform/docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql`, 'utf8')
  // Existing conversion fixture tables intentionally have only source columns. Add technical columns late,
  // after historical positional INSERT tests; production schemas are never altered by this harness.
  await pool.query(`ALTER TABLE tenants ADD tenant_name VARCHAR(255) DEFAULT 'Fixture', ADD default_deployment_mode VARCHAR(64) DEFAULT 'customer-hosted', ADD onboarding_stage VARCHAR(32), ADD onboarding_updated_at DATETIME, ADD onboarding_completed_at DATETIME, ADD activated_at DATETIME, ADD updated_at DATETIME;
    ALTER TABLE tenant_subscriptions MODIFY id BIGINT AUTO_INCREMENT, ADD subscription_no VARCHAR(128), ADD source VARCHAR(64), ADD created_by_account_id BIGINT, ADD created_at DATETIME;
    ALTER TABLE subscriptions MODIFY id BIGINT AUTO_INCREMENT, ADD subscription_no VARCHAR(128), ADD source VARCHAR(64), ADD created_by_account_id BIGINT, ADD created_at DATETIME;
    ALTER TABLE licenses MODIFY id BIGINT AUTO_INCREMENT, ADD license_code VARCHAR(128), ADD plan_code VARCHAR(64), ADD signed_token LONGTEXT, ADD created_at DATETIME;
    ALTER TABLE license_deployments MODIFY id BIGINT AUTO_INCREMENT, ADD created_at DATETIME;`)
  for (const table of ['tenant_onboarding_steps', 'deployment_sites', 'deployments', 'deployment_bootstrap_secrets', 'tenant_runtime_credentials', 'platform_applications', 'platform_app_manifests', 'platform_app_manifest_resource_actions']) {
    const statement = ddl.match(new RegExp('CREATE TABLE IF NOT EXISTS `' + table + '` \\([\\s\\S]*?\\) ENGINE[^;]+;'))?.[0]
    assert.ok(statement, `fixture schema ${table}`)
    // Existing minimal conversion IDs are signed; remove only FK declarations from new fixture tables.
    await pool.query(statement.split('\n').filter(line => !/^\s*(CONSTRAINT|FOREIGN KEY|REFERENCES|ON DELETE|ON UPDATE)\b/.test(line)).join('\n').replace(/,\s*\) ENGINE/, '\n) ENGINE'))
  }
  await pool.query('CREATE TABLE tenant_subjects (tenant_code VARCHAR(64),subject_type VARCHAR(32),status VARCHAR(32))')
  const logical = { appCode: 'aims', appType: 'business', recommendedRoles: [], resources: [{ code: 'projects', actions: ['view'] }] }
  const assets = { appCode: 'assets', appType: 'business', recommendedRoles: [], resources: [{ code: 'products', actions: ['view'] }] }
  const host = composeManifest([logical, assets])
  for (const [id, code, manifest] of [[501, 'enterprise', host], [502, 'aims', logical], [503, 'console', {appCode:'console',resources:[]}], [504,'assets',assets]]) {
    await pool.execute('INSERT INTO platform_applications (app_code,app_name,status,latest_manifest_id) VALUES (?,?,\'active\',?)', [code, code, id])
    await pool.execute('INSERT INTO platform_app_manifests (id,app_code,manifest_seq,manifest_hash,manifest_json,status) VALUES (?,?,1,?,?,\'active\')', [id,code,createHash('sha256').update(canonical(manifest)).digest('hex'),JSON.stringify(manifest)])
  }
  await pool.query("INSERT INTO platform_app_manifest_resource_actions (manifest_resource_id,manifest_id,app_code,resource_code,action,status) VALUES (1,502,'aims','projects','view','active'),(2,504,'assets','products','view','active')")
  const repo = createEnterpriseOrderFulfillmentRepository(withTransaction)
  const states = createEnterpriseEntitlementStateRepository(withTransaction)
  for (const [id, tenant] of [[301, 'provision-a'], [302, 'provision-b']]) {
    await pool.execute("INSERT INTO tenants (tenant_code,status) VALUES (?,'active')",[tenant])
    await pool.execute("INSERT INTO platform_orders (id,order_no,tenant_code,plan_code,status,effective_from,effective_until,total_amount,currency) VALUES (?,?,?,'enterprise-full','paid','2026-09-01','2027-03-15',120,'CNY')",[id,`ORDER-${id}`,tenant])
    await pool.execute("INSERT INTO platform_payments (payment_no,order_id,tenant_code,amount,currency,status) VALUES (?,?,?,120,'CNY','succeeded')",[`PAY-${id}`,id,tenant])
    await repo.fulfill({tenantCode:tenant,orderId:id,actorUid:'ops-fixture'},new Date().toISOString())
    await pool.execute("INSERT INTO deployment_sites (tenant_code,site_code,site_name,public_url,root_app_code,environment) VALUES (?,?,?,'https://fixture.invalid','enterprise','test')",[tenant,tenant,tenant])
  }
  await pool.query("INSERT INTO licenses (id,tenant_code,subscription_id,status,issued_at,expires_at,license_code,signed_token) VALUES (900,'provision-a',900,'expired','2024-01-01','2025-01-01','HISTORICAL','unchanged-history')")
  const history = (await pool.query("SELECT * FROM licenses WHERE id=900"))[0][0]
  const { startOnboarding } = await import('../../server/utils/onboardingFlow.ts')
  const input = {tenantCode:'provision-a',planCode:'enterprise-full',environment:'test',generateBundle:false}
  const first = await startOnboarding(input)
  assert.ok(first.runtimeToken)
  assert.equal(first.subscriptions.length,2)
  assert.equal(first.bundle,null)
  const token = JSON.parse(first.license.signedToken)
  assert.equal(token.payload.expiresAt,'2027-03-15T00:00:00.000Z')
  assert.equal(verify(null,Buffer.from(JSON.stringify(token.payload)),publicKey,Buffer.from(token.signature,'base64')),true)
  const credential = (await pool.query("SELECT * FROM tenant_runtime_credentials WHERE tenant_code='provision-a'"))[0][0]
  const again = await startOnboarding(input)
  assert.equal(again.runtimeToken,null)
  assert.equal(again.license.signedToken,first.license.signedToken)
  assert.deepEqual((await pool.query("SELECT * FROM tenant_runtime_credentials WHERE tenant_code='provision-a'"))[0][0],credential)
  assert.deepEqual((await pool.query('SELECT * FROM licenses WHERE id=900'))[0][0],history)
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM deployments WHERE tenant_code='provision-a'"))[0][0].n),2)
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM licenses WHERE tenant_code='provision-a'"))[0][0].n),2)
  await assert.rejects(startOnboarding({...input,licenseExpiresAt:'2028-01-01'}),/period_override_forbidden/)
  await states.change({tenantCode:'provision-a',operationId:'provision-pause',expectedRevision:1,action:'suspend',actorUid:'ops-fixture',reason:'fixture'},new Date().toISOString())
  await assert.rejects(startOnboarding(input),/qualification_inactive/)
  await states.change({tenantCode:'provision-a',operationId:'provision-resume',expectedRevision:2,action:'restore',actorUid:'ops-fixture',reason:'fixture'},new Date().toISOString())
  const resumed = await startOnboarding(input)
  assert.equal(JSON.parse(resumed.license.signedToken).payload.expiresAt, token.payload.expiresAt)
  assert.notEqual(resumed.license.id,first.license.id)
  assert.equal((await pool.execute('SELECT signed_token FROM licenses WHERE id=?',[first.license.id]))[0][0].signed_token,first.license.signedToken)
  await pool.execute("UPDATE licenses SET status='revoked' WHERE id=?",[resumed.license.id])
  await assert.rejects(startOnboarding(input),/license_inactive/)
  await pool.execute("UPDATE licenses SET status='active' WHERE id=?",[resumed.license.id])
  await pool.query("UPDATE tenant_runtime_credentials SET status='revoked',revoked_at=UTC_TIMESTAMP() WHERE tenant_code='provision-a'")
  await assert.rejects(startOnboarding(input),/credential_inactive/)
  assert.equal((await pool.query("SELECT status FROM tenant_runtime_credentials WHERE tenant_code='provision-a'"))[0][0].status,'revoked')
  await pool.query("DELETE FROM platform_app_manifest_resource_actions WHERE app_code='aims'")
  await assert.rejects(startOnboarding({...input,tenantCode:'provision-b'}),/logical_actions_required/)
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM deployments WHERE tenant_code='provision-b'"))[0][0].n),0)
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM subscriptions WHERE tenant_code='provision-b'"))[0][0].n),0)
  await pool.query("INSERT INTO platform_app_manifest_resource_actions (manifest_resource_id,manifest_id,app_code,resource_code,action,status) VALUES (1,502,'aims','projects','view','active')")
  console.log('Enterprise provisioning: real onboarding, exact signed License, technical routes, retry credential preservation, history preservation, suspension and missing logical actions rollback passed.')
}
