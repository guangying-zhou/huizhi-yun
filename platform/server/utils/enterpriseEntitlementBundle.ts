import type { RowDataPacket } from 'mysql2/promise'
import { ENTERPRISE_ENTITLEMENT_SCHEMA, ENTERPRISE_PRODUCT_CODE, enterpriseStatusAt, normalizeEnterprisePeriod, type EnterpriseEntitlement, type EnterpriseStatus } from './enterpriseEntitlement.ts'

type EntitlementQuery = <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
type Row = RowDataPacket & { revision: number, entitlement_json: unknown }

export interface BundleEnterpriseEntitlement extends EnterpriseEntitlement {
  effectiveStatus: EnterpriseStatus
}

/**
 * The tenant-admin catalog keeps legacy commercial plans only until a tenant
 * has a unified entitlement. An inactive unified entitlement is deliberately
 * distinct from legacy: it must not fall back to a historical plan's apps.
 */
export function enterpriseCatalogMode(entitlement: BundleEnterpriseEntitlement | null) {
  if (!entitlement) return 'legacy-plan' as const
  return entitlement.effectiveStatus === 'active' ? 'enterprise-full' as const : 'enterprise-inactive' as const
}

/** Missing pointer means legacy; missing schema/record or corrupt facts never mean legacy. */
export async function loadBundleEnterpriseEntitlement(query: EntitlementQuery, tenantCode: string, tenantStatus: string, now: string): Promise<BundleEnterpriseEntitlement | null> {
  const row = await query<Row>(`SELECT c.revision, e.entitlement_json
    FROM tenant_enterprise_entitlement_current c
    LEFT JOIN tenant_enterprise_entitlements e ON e.tenant_code = c.tenant_code AND e.revision = c.revision
    WHERE c.tenant_code = ?`, [tenantCode])
  if (!row) return null
  const value = typeof row.entitlement_json === 'string' ? JSON.parse(row.entitlement_json) : row.entitlement_json
  if (!value || typeof value !== 'object') throw new Error('enterprise_entitlement_snapshot_invalid')
  const entitlement = value as EnterpriseEntitlement
  if (entitlement.tenantCode !== tenantCode || entitlement.schemaVersion !== ENTERPRISE_ENTITLEMENT_SCHEMA || entitlement.productCode !== ENTERPRISE_PRODUCT_CODE || !Number.isSafeInteger(entitlement.revision) || entitlement.revision < 1 || entitlement.revision !== Number(row.revision)) throw new Error('enterprise_entitlement_snapshot_invalid')
  const normalized = { ...entitlement, ...normalizeEnterprisePeriod(entitlement) }
  let effectiveStatus = enterpriseStatusAt(normalized, now)
  if (tenantStatus !== 'active' && effectiveStatus !== 'revoked') effectiveStatus = tenantStatus === 'revoked' ? 'revoked' : 'suspended'
  return { ...normalized, effectiveStatus }
}

export function enterpriseModuleAvailability(applications: Array<{ appCode: string }>, deployments: Array<{ appCode: string, status: string }>, hostRoutes: Array<{ appCode: string }> = []) {
  const deployed = new Set([...deployments.filter(item => item.status === 'active').map(item => item.appCode), ...hostRoutes.map(item => item.appCode)])
  return applications.map(item => ({ appCode: item.appCode, deploymentState: deployed.has(item.appCode) ? 'deployed' : 'not-deployed', configurationState: 'unknown' }))
}

/** Technical catalog has no commercial plan filter. Account remains legacy/excluded; Platform remains a separate control plane. */
export const ENTERPRISE_MODULE_CATALOG_SQL = `SELECT DISTINCT pa.app_code AS appCode
  FROM platform_applications pa
  INNER JOIN platform_app_manifests pam ON pam.app_code = pa.app_code AND pam.status = 'active'
  WHERE pa.status = 'active' AND pa.bundle_enabled = 1 AND pa.app_code NOT IN ('account', 'platform')
  ORDER BY pa.app_code`

export function bundleEnterpriseEntitlementMatches(payload: Record<string, unknown>, current: BundleEnterpriseEntitlement | null): boolean {
  const existing = payload.enterpriseEntitlement as Partial<BundleEnterpriseEntitlement> | undefined
  if (!current) {
    if (existing) throw new Error('enterprise_entitlement_pointer_missing')
    return true
  }
  return !!existing && existing.schemaVersion === current.schemaVersion && existing.tenantCode === current.tenantCode && existing.revision === current.revision && existing.status === current.status && existing.effectiveStatus === current.effectiveStatus
}
