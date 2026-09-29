import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBundleEnterpriseEntitlement, bundleEnterpriseEntitlementMatches, enterpriseCatalogMode, enterpriseModuleAvailability, ENTERPRISE_MODULE_CATALOG_SQL } from '../server/utils/enterpriseEntitlementBundle.ts'
import type { RowDataPacket } from 'mysql2/promise'

const grant = { tenantCode: 't1', revision: 4, schemaVersion: 'enterprise-entitlement.v1', productCode: 'enterprise-full', status: 'active', effectiveFrom: '2026-01-01T00:00:00Z', end: { kind: 'finite', effectiveUntil: '2027-01-01T00:00:00Z' } }
function query(value: unknown, revision = 4) {
  return async <T extends RowDataPacket>(): Promise<T | null> => ({ revision, entitlement_json: value }) as unknown as T
}
const now = '2026-09-13T00:00:00Z'
test('absent pointer preserves legacy, unavailable schema never degrades into legacy', async () => {
  assert.equal(await loadBundleEnterpriseEntitlement(async () => null, 't1', 'active', now), null)
  await assert.rejects(loadBundleEnterpriseEntitlement(async () => {
    throw new Error('schema_missing')
  }, 't1', 'active', now), /schema_missing/)
  await assert.rejects(loadBundleEnterpriseEntitlement(query(null), 't1', 'active', now), /snapshot_invalid/)
})
test('signed qualification derives exact current revision and evaluates half-open expiry', async () => {
  const current = await loadBundleEnterpriseEntitlement(query(JSON.stringify(grant)), 't1', 'active', now)
  assert.equal(current?.revision, 4)
  assert.equal(current?.effectiveStatus, 'active')
  assert.equal((await loadBundleEnterpriseEntitlement(query(grant), 't1', 'active', grant.end.effectiveUntil))?.effectiveStatus, 'expired')
  assert.equal((await loadBundleEnterpriseEntitlement(query(grant), 't1', 'suspended', now))?.effectiveStatus, 'suspended')
  assert.equal((await loadBundleEnterpriseEntitlement(query({ ...grant, status: 'revoked' }), 't1', 'active', now))?.effectiveStatus, 'revoked')
})
test('mismatched tenant, revision, product or schema fail before signed output', async () => {
  for (const override of [{ tenantCode: 't2' }, { revision: 3 }, { productCode: 'professional' }, { schemaVersion: 'unknown' }]) {
    await assert.rejects(loadBundleEnterpriseEntitlement(query({ ...grant, ...override }), 't1', 'active', now), /snapshot_invalid/)
  }
})
test('stale qualification prevents reuse and current pointer cannot disappear into legacy', async () => {
  const current = await loadBundleEnterpriseEntitlement(query(grant), 't1', 'active', now)
  assert.equal(bundleEnterpriseEntitlementMatches({}, current), false)
  assert.equal(bundleEnterpriseEntitlementMatches({ enterpriseEntitlement: current }, current), true)
  assert.equal(bundleEnterpriseEntitlementMatches({ enterpriseEntitlement: { ...current, revision: 3 } }, current), false)
  assert.equal(bundleEnterpriseEntitlementMatches({ enterpriseEntitlement: { ...current, effectiveStatus: 'suspended' } }, current), false)
  assert.throws(() => bundleEnterpriseEntitlementMatches({ enterpriseEntitlement: current }, null), /pointer_missing/)
})
test('module catalog is manifest-derived without subscription gate; availability does not assert configuration', () => {
  assert.doesNotMatch(ENTERPRISE_MODULE_CATALOG_SQL, /subscriptions|platform_plan_apps/)
  assert.match(ENTERPRISE_MODULE_CATALOG_SQL, /platform_app_manifests/)
  assert.deepEqual(enterpriseModuleAvailability([{ appCode: 'aims' }, { appCode: 'codocs' }], [{ appCode: 'aims', status: 'active' }]), [
    { appCode: 'aims', deploymentState: 'deployed', configurationState: 'unknown' },
    { appCode: 'codocs', deploymentState: 'not-deployed', configurationState: 'unknown' }
  ])
})
test('unified catalog never falls back to a historical commercial plan', async () => {
  const active = await loadBundleEnterpriseEntitlement(query(grant), 't1', 'active', now)
  const suspended = await loadBundleEnterpriseEntitlement(query({ ...grant, status: 'suspended' }), 't1', 'active', now)
  assert.equal(enterpriseCatalogMode(null), 'legacy-plan')
  assert.equal(enterpriseCatalogMode(active), 'enterprise-full')
  assert.equal(enterpriseCatalogMode(suspended), 'enterprise-inactive')

  const source = readFileSync(new URL('../server/api/platform/tenant-admin/application-catalog.get.ts', import.meta.url), 'utf8')
  assert.match(source, /loadBundleEnterpriseEntitlement\(queryRow, tenantCode, tenant\.status/)
  assert.match(source, /FROM \(\$\{ENTERPRISE_MODULE_CATALOG_SQL\}\) catalog/)
  assert.match(source, /catalogMode === 'enterprise-full'/)
  const enterpriseBranch = source.slice(source.indexOf('if (catalogMode !== \'legacy-plan\')'), source.indexOf('const current ='))
  assert.doesNotMatch(enterpriseBranch, /platform_plan_apps/)
})
test('bundle producer adds qualification without expanding automatic personnel grants', () => {
  const source = readFileSync(new URL('../server/utils/policyBundle.ts', import.meta.url), 'utf8')
  assert.match(source, /collectConfiguredBaselinePermissions\(legacyAppCodes\)/)
  assert.match(source, /collectSystemAppRoleMaps\(legacyAppCodes\)/)
  assert.match(source, /enterpriseEntitlement, enterpriseHostRoutes, moduleAvailability: enterpriseModuleAvailability\(applications, deployments, enterpriseHostRoutes\)/)
  assert.match(source, /bundleEnterpriseEntitlementMatches\(parsePolicyBundlePayload\(existing.bundle_payload_json\), currentEntitlement\)/)
})
