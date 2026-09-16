import { createHash } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

type QueryExecutor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

interface PermissionPolicyRow extends RowDataPacket {
  app_code: string
  resource_code: string
  action: string
  manifest_action_id?: number | null
  source_manifest_action_id?: number | null
}

interface ScopePolicyRow extends PermissionPolicyRow {
  scope_type: string
  scope_value: string
  status: string
}

interface SystemRolePolicyRow extends RowDataPacket {
  policy_hash: string | null
}

interface TenantRolePolicyRow extends RowDataPacket {
  source_policy_hash: string | null
  effective_policy_hash: string | null
  is_overridden: number
}

interface IdRow extends RowDataPacket {
  id: number
}

interface TenantRoleBackfillRow extends IdRow {
  tenant_code: string
  source: string
  source_role_code: string | null
  is_overridden: number
  system_policy_hash: string | null
}

export type RolePolicyStatus = 'not_enabled' | 'synced' | 'system_updated' | 'tenant_overridden' | 'drifted' | 'unknown'

interface PolicySnapshot {
  policyHash: string
  permissionCount: number
  scopeCount: number
}

function normalizeActionId(row: PermissionPolicyRow) {
  const id = Number(row.manifest_action_id ?? row.source_manifest_action_id ?? 0)
  return Number.isInteger(id) && id > 0 ? id : null
}

function compareStrings(left: string, right: string) {
  return left.localeCompare(right)
}

function buildPolicyHash(permissions: PermissionPolicyRow[], scopes: ScopePolicyRow[]): PolicySnapshot {
  const normalizedPermissions = permissions.map(item => ({
    appCode: item.app_code,
    resourceCode: item.resource_code,
    action: item.action,
    manifestActionId: normalizeActionId(item)
  })).sort((left, right) =>
    compareStrings(left.appCode, right.appCode)
    || compareStrings(left.resourceCode, right.resourceCode)
    || compareStrings(left.action, right.action)
    || Number(left.manifestActionId || 0) - Number(right.manifestActionId || 0)
  )

  const normalizedScopes = scopes.map(item => ({
    appCode: item.app_code,
    resourceCode: item.resource_code,
    action: item.action,
    manifestActionId: normalizeActionId(item),
    scopeType: item.scope_type,
    scopeValue: item.scope_value,
    status: item.status
  })).sort((left, right) =>
    compareStrings(left.appCode, right.appCode)
    || compareStrings(left.resourceCode, right.resourceCode)
    || compareStrings(left.action, right.action)
    || compareStrings(left.scopeType, right.scopeType)
    || compareStrings(left.scopeValue, right.scopeValue)
    || compareStrings(left.status, right.status)
    || Number(left.manifestActionId || 0) - Number(right.manifestActionId || 0)
  )

  const serialized = JSON.stringify({
    version: 1,
    permissions: normalizedPermissions,
    scopes: normalizedScopes
  })

  return {
    policyHash: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
    permissionCount: normalizedPermissions.length,
    scopeCount: normalizedScopes.length
  }
}

async function loadSystemRolePolicy(executor: QueryExecutor, systemRoleId: number) {
  const permissions = await executor.queryRows<PermissionPolicyRow[]>(
    `SELECT app_code, resource_code, action, manifest_action_id
     FROM platform_app_role_permissions
     WHERE app_role_id = ?`,
    [systemRoleId]
  )
  const scopes = await executor.queryRows<ScopePolicyRow[]>(
    `SELECT app_code, resource_code, action, manifest_action_id, scope_type, scope_value, status
     FROM platform_app_role_scopes
     WHERE app_role_id = ?`,
    [systemRoleId]
  )

  return buildPolicyHash(permissions, scopes)
}

async function loadEnterpriseSystemRolePolicy(executor: QueryExecutor, systemRoleId: number) {
  const permissions = await executor.queryRows<PermissionPolicyRow[]>(
    `SELECT arp.app_code, arp.resource_code, arp.action, arp.manifest_action_id
     FROM platform_system_app_role_maps sarm
     INNER JOIN platform_app_roles ar
       ON ar.id = sarm.app_role_id
      AND ar.status = 'active'
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     WHERE sarm.system_role_id = ?`,
    [systemRoleId]
  )
  const scopes = await executor.queryRows<ScopePolicyRow[]>(
    `SELECT ars.app_code, ars.resource_code, ars.action, ars.manifest_action_id,
            ars.scope_type, ars.scope_value, ars.status
     FROM platform_system_app_role_maps sarm
     INNER JOIN platform_app_roles ar
       ON ar.id = sarm.app_role_id
      AND ar.status = 'active'
     INNER JOIN platform_app_role_scopes ars
       ON ars.app_role_id = ar.id
      AND ars.status = 'active'
     WHERE sarm.system_role_id = ?`,
    [systemRoleId]
  )

  return buildPolicyHash(permissions, scopes)
}

async function loadTenantRolePolicy(executor: QueryExecutor, tenantCode: string, roleId: number) {
  const permissions = await executor.queryRows<PermissionPolicyRow[]>(
    `SELECT app_code, resource_code, action, source_manifest_action_id
     FROM tenant_role_permissions
     WHERE tenant_code = ?
       AND role_id = ?
     UNION ALL
     SELECT arp.app_code, arp.resource_code, arp.action, arp.manifest_action_id AS source_manifest_action_id
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     WHERE tram.tenant_code = ?
       AND tram.role_id = ?`,
    [tenantCode, roleId, tenantCode, roleId]
  )
  const scopes = await executor.queryRows<ScopePolicyRow[]>(
    `SELECT app_code, resource_code, action, source_manifest_action_id, scope_type, scope_value, status
     FROM tenant_role_scopes
     WHERE tenant_code = ?
       AND role_id = ?
     UNION ALL
     SELECT ars.app_code, ars.resource_code, ars.action, ars.manifest_action_id AS source_manifest_action_id,
            ars.scope_type, ars.scope_value, ars.status
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
     INNER JOIN platform_app_role_scopes ars
       ON ars.app_role_id = ar.id
      AND ars.status = 'active'
     WHERE tram.tenant_code = ?
       AND tram.role_id = ?`,
    [tenantCode, roleId, tenantCode, roleId]
  )

  return buildPolicyHash(permissions, scopes)
}

export async function refreshSystemRolePolicySnapshot(executor: QueryExecutor, systemRoleId: number) {
  const snapshot = await loadSystemRolePolicy(executor, systemRoleId)
  const current = await executor.queryRow<SystemRolePolicyRow>(
    `SELECT policy_hash
     FROM platform_app_roles
     WHERE id = ?
     LIMIT 1`,
    [systemRoleId]
  )
  const changed = current?.policy_hash !== snapshot.policyHash

  await executor.execute<ResultSetHeader>(
    `UPDATE platform_app_roles
     SET policy_hash = ?,
         policy_revision = policy_revision + ?,
         policy_updated_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP() ELSE policy_updated_at END,
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [snapshot.policyHash, changed ? 1 : 0, changed ? 1 : 0, systemRoleId]
  )

  return {
    ...snapshot,
    changed
  }
}

export async function refreshEnterpriseSystemRolePolicySnapshot(executor: QueryExecutor, systemRoleId: number) {
  const snapshot = await loadEnterpriseSystemRolePolicy(executor, systemRoleId)
  const current = await executor.queryRow<SystemRolePolicyRow>(
    `SELECT policy_hash
     FROM platform_system_roles
     WHERE id = ?
     LIMIT 1`,
    [systemRoleId]
  )
  const changed = current?.policy_hash !== snapshot.policyHash

  await executor.execute<ResultSetHeader>(
    `UPDATE platform_system_roles
     SET policy_hash = ?,
         policy_revision = policy_revision + ?,
         policy_updated_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP() ELSE policy_updated_at END,
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [snapshot.policyHash, changed ? 1 : 0, changed ? 1 : 0, systemRoleId]
  )

  return {
    ...snapshot,
    changed
  }
}

export async function refreshTenantRolePolicySnapshot(
  executor: QueryExecutor,
  tenantCode: string,
  roleId: number,
  options: {
    sourcePolicyHash?: string | null
    isOverridden?: boolean
  } = {}
) {
  const snapshot = await loadTenantRolePolicy(executor, tenantCode, roleId)
  const current = await executor.queryRow<TenantRolePolicyRow>(
    `SELECT source_policy_hash, effective_policy_hash, is_overridden
     FROM tenant_roles
     WHERE tenant_code = ?
       AND id = ?
     LIMIT 1`,
    [tenantCode, roleId]
  )

  const nextSourcePolicyHash = options.sourcePolicyHash === undefined
    ? current?.source_policy_hash || null
    : options.sourcePolicyHash
  const nextIsOverridden = options.isOverridden === undefined
    ? Boolean(current?.is_overridden)
    : options.isOverridden
  const changed = !current
    || current.effective_policy_hash !== snapshot.policyHash
    || current.source_policy_hash !== nextSourcePolicyHash
    || Boolean(current.is_overridden) !== nextIsOverridden

  await executor.execute<ResultSetHeader>(
    `UPDATE tenant_roles
     SET source_policy_hash = ?,
         effective_policy_hash = ?,
         is_overridden = ?,
         policy_revision = policy_revision + ?,
         policy_updated_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP() ELSE policy_updated_at END,
         updated_at = UTC_TIMESTAMP()
     WHERE tenant_code = ?
       AND id = ?`,
    [
      nextSourcePolicyHash,
      snapshot.policyHash,
      nextIsOverridden ? 1 : 0,
      changed ? 1 : 0,
      changed ? 1 : 0,
      tenantCode,
      roleId
    ]
  )

  return {
    ...snapshot,
    sourcePolicyHash: nextSourcePolicyHash,
    isOverridden: nextIsOverridden,
    changed
  }
}

export async function refreshMissingRolePolicySnapshots(
  executor: QueryExecutor,
  options: {
    tenantCode?: string | null
    appCode?: string | null
  } = {}
) {
  const systemWhere: string[] = ['policy_hash IS NULL']
  const systemParams: unknown[] = []

  if (options.appCode) {
    systemWhere.push('app_code = ?')
    systemParams.push(options.appCode)
  }

  const systemRows = await executor.queryRows<IdRow[]>(
    `SELECT id
     FROM platform_app_roles
     WHERE ${systemWhere.join(' AND ')}
     ORDER BY id ASC
     LIMIT 500`,
    systemParams
  )

  for (const row of systemRows) {
    await refreshSystemRolePolicySnapshot(executor, row.id)
  }

  if (!options.tenantCode) {
    return {
      systemRoleCount: systemRows.length,
      tenantRoleCount: 0
    }
  }

  const tenantWhere: string[] = [
    'tr.tenant_code = ?',
    '(tr.effective_policy_hash IS NULL OR (tr.source = \'system\' AND tr.source_policy_hash IS NULL))'
  ]
  const tenantParams: unknown[] = [options.tenantCode]

  if (options.appCode) {
    tenantWhere.push(`EXISTS (
      SELECT 1
      FROM tenant_role_app_role_maps tram
      INNER JOIN platform_app_roles ar
        ON ar.role_code = tram.app_role_code
      WHERE tram.tenant_code = tr.tenant_code
        AND tram.role_id = tr.id
        AND ar.app_code = ?
    )`)
    tenantParams.push(options.appCode)
  }

  const tenantRows = await executor.queryRows<TenantRoleBackfillRow[]>(
    `SELECT tr.id,
            tr.tenant_code,
            tr.source,
            tr.source_role_code,
            tr.is_overridden,
            psr.policy_hash AS system_policy_hash
     FROM tenant_roles tr
     LEFT JOIN platform_system_roles psr
       ON psr.role_code = tr.source_role_code
     WHERE ${tenantWhere.join(' AND ')}
     ORDER BY tr.id ASC
     LIMIT 500`,
    tenantParams
  )

  for (const row of tenantRows) {
    await refreshTenantRolePolicySnapshot(executor, row.tenant_code, row.id, {
      sourcePolicyHash: row.source === 'system' ? row.system_policy_hash : undefined,
      isOverridden: Boolean(row.is_overridden)
    })
  }

  return {
    systemRoleCount: systemRows.length,
    tenantRoleCount: tenantRows.length
  }
}

export function resolveRolePolicyStatus(input: {
  enabled: boolean
  systemPolicyHash?: string | null
  tenantSourcePolicyHash?: string | null
  tenantEffectivePolicyHash?: string | null
  tenantIsOverridden?: boolean | null
}): RolePolicyStatus {
  if (!input.enabled) return 'not_enabled'

  const systemHash = input.systemPolicyHash || null
  const sourceHash = input.tenantSourcePolicyHash || null
  const effectiveHash = input.tenantEffectivePolicyHash || null
  const isOverridden = Boolean(input.tenantIsOverridden)

  if (!systemHash || !sourceHash || !effectiveHash) return 'unknown'

  const systemChanged = sourceHash !== systemHash
  const tenantChanged = isOverridden || effectiveHash !== sourceHash

  if (systemChanged && tenantChanged) return 'drifted'
  if (systemChanged) return 'system_updated'
  if (tenantChanged) return 'tenant_overridden'
  if (effectiveHash === systemHash) return 'synced'

  return 'unknown'
}
