import { createError } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ENTERPRISE_MODULE_CATALOG_SQL, loadBundleEnterpriseEntitlement } from './enterpriseEntitlementBundle.ts'

type Row = RowDataPacket & Record<string, unknown>
type Query = <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>

/**
 * Legacy registry callers remain subscription-backed. A converted enterprise
 * instead reads the published technical catalog: logical Host modules do not
 * receive synthetic per-app subscriptions just to retrieve their manifest.
 * This admits catalog metadata only; deployment/readiness remains separate.
 */
export async function requireTenantManifestReadAccess(query: Query, tenantCode: string, appCode: string, now = new Date().toISOString()) {
  const subscription = await query<Row>(`SELECT id
     FROM subscriptions
     WHERE tenant_code = ?
       AND app_code = ?
       AND status = 'active'
     LIMIT 1`, [tenantCode, appCode])
  if (subscription) return { mode: 'legacy-subscription' as const }

  const tenant = await query<Row>('SELECT status FROM tenants WHERE tenant_code = ? LIMIT 1', [tenantCode])
  if (!tenant) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `tenant not found: tenantCode=${tenantCode}` })
  const entitlement = await loadBundleEnterpriseEntitlement(query, tenantCode, String(tenant.status), now)
  if (!entitlement) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `active subscription not found: tenantCode=${tenantCode}, appCode=${appCode}` })
  if (entitlement.effectiveStatus !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Enterprise access is not active', data: { code: 'enterprise_entitlement_inactive' } })
  }

  const catalogEntry = await query<Row>(`SELECT appCode
     FROM (${ENTERPRISE_MODULE_CATALOG_SQL}) enterprise_catalog
     WHERE appCode = ?`, [appCode])
  if (!catalogEntry) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `manifest not found for appCode=${appCode}` })
  return { mode: 'enterprise-catalog' as const, entitlementRevision: entitlement.revision }
}
