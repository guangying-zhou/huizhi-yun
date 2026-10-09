import test from 'node:test'
import assert from 'node:assert/strict'
import type { RowDataPacket } from 'mysql2/promise'
import { requireTenantManifestReadAccess } from '../server/utils/enterpriseManifestAccess.ts'

const active = { revision: 2, entitlement_json: { schemaVersion: 'enterprise-entitlement.v1', productCode: 'enterprise-full', tenantCode: 't1', revision: 2, status: 'active', effectiveFrom: '2026-01-01T00:00:00Z', end: { kind: 'finite', effectiveUntil: '2027-01-01T00:00:00Z' } } }

function query(rows: { subscription?: unknown, tenant?: unknown, entitlement?: unknown, catalog?: unknown }) {
  return async <T extends RowDataPacket>(sql: string): Promise<T | null> => {
    if (sql.includes('FROM subscriptions')) return (rows.subscription || null) as T | null
    if (sql.includes('FROM tenants')) return (rows.tenant || null) as T | null
    if (sql.includes('tenant_enterprise_entitlement_current')) return (rows.entitlement || null) as T | null
    if (sql.includes('enterprise_catalog')) return (rows.catalog || null) as T | null
    throw new Error(`unexpected query: ${sql}`)
  }
}

test('legacy active subscription remains compatible without an entitlement lookup', async () => {
  const result = await requireTenantManifestReadAccess(query({ subscription: { id: 1 } }), 't1', 'aims', '2026-09-13T00:00:00Z')
  assert.deepEqual(result, { mode: 'legacy-subscription' })
})

test('active unified entitlement reads a published module without a synthetic subscription', async () => {
  const result = await requireTenantManifestReadAccess(query({ tenant: { status: 'active' }, entitlement: active, catalog: { appCode: 'assets' } }), 't1', 'assets', '2026-09-13T00:00:00Z')
  assert.deepEqual(result, { mode: 'enterprise-catalog', entitlementRevision: 2 })
})

test('inactive entitlement and unpublished module fail closed with distinct outcomes', async () => {
  const suspended = { ...active, entitlement_json: { ...active.entitlement_json, status: 'suspended' } }
  await assert.rejects(requireTenantManifestReadAccess(query({ tenant: { status: 'active' }, entitlement: suspended, catalog: { appCode: 'assets' } }), 't1', 'assets', '2026-09-13T00:00:00Z'), (error: { statusCode?: number, data?: { code?: string } }) => error.statusCode === 403 && error.data?.code === 'enterprise_entitlement_inactive')
  await assert.rejects(requireTenantManifestReadAccess(query({ tenant: { status: 'active' }, entitlement: active }), 't1', 'unknown', '2026-09-13T00:00:00Z'), (error: { statusCode?: number }) => error.statusCode === 404)
})
