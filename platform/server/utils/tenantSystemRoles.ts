import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  refreshEnterpriseSystemRolePolicySnapshot,
  refreshTenantRolePolicySnapshot
} from '~~/server/utils/rolePolicyHash'

type QueryExecutor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

interface SystemRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  description: string | null
  is_required: number
  status: string
}

interface TenantRoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  description: string | null
  source: string
  source_role_code: string | null
  source_manifest_id: number | null
  is_overridden: number
  is_assignable: number
  status: string
}

interface AppRoleMapRow extends RowDataPacket {
  app_role_code: string
  sort_order: number
}

interface PermissionRow extends RowDataPacket {
  app_role_code?: string
  app_code: string
  resource_code: string
  action: string
  manifest_action_id?: number | null
  source_manifest_action_id?: number | null
}

interface ScopeRow extends PermissionRow {
  scope_type: string
  scope_value: string
  status: string
}

interface MaterializeInput {
  tenantCode: string
  systemRoleCode: string
  force?: boolean
}

const TENANT_SYSTEM_ROLE_TYPE = 'system'

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function permissionKey(item: Pick<PermissionRow, 'app_code' | 'resource_code' | 'action'>) {
  return `${item.app_code}::${item.resource_code}::${item.action}`
}

function mapTenantRole(row: TenantRoleRow | null) {
  if (!row) return null

  return {
    id: row.id,
    tenantCode: row.tenant_code,
    roleCode: row.role_code,
    roleName: row.role_name,
    roleType: row.role_type,
    appCode: row.app_code,
    description: row.description,
    source: row.source,
    sourceRoleCode: row.source_role_code,
    sourceManifestId: row.source_manifest_id,
    isOverridden: Boolean(row.is_overridden),
    isAssignable: Boolean(row.is_assignable),
    status: row.status
  }
}

async function ensureTenantExists(executor: QueryExecutor, tenantCode: string) {
  const tenant = await executor.queryRow<RowDataPacket>(
    'SELECT tenant_code FROM tenants WHERE tenant_code = ? LIMIT 1',
    [tenantCode]
  )

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }
}

async function loadSystemRole(executor: QueryExecutor, roleCode: string) {
  const role = await executor.queryRow<SystemRoleRow>(
    `SELECT id, role_code, role_name, role_type, description, is_required, status
     FROM platform_system_roles
     WHERE role_code = ?
     LIMIT 1`,
    [roleCode]
  )

  if (!role || role.status !== 'active') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `active system role not found: roleCode=${roleCode}`
    })
  }

  return role
}

async function loadTenantRoleBySource(executor: QueryExecutor, tenantCode: string, systemRoleCode: string) {
  return executor.queryRow<TenantRoleRow>(
    `SELECT id, tenant_code, role_code, role_name, role_type, app_code, description,
            source, source_role_code, source_manifest_id, is_overridden, is_assignable, status
     FROM tenant_roles
     WHERE tenant_code = ?
       AND (source_role_code = ? OR role_code = ?)
     LIMIT 1`,
    [tenantCode, systemRoleCode, systemRoleCode]
  )
}

async function loadSystemAppRoleMaps(executor: QueryExecutor, systemRoleId: number) {
  return executor.queryRows<AppRoleMapRow[]>(
    `SELECT app_role_code, sort_order
     FROM platform_system_app_role_maps
     WHERE system_role_id = ?
     ORDER BY sort_order ASC, app_role_code ASC`,
    [systemRoleId]
  )
}

async function loadTenantAppRoleMaps(executor: QueryExecutor, tenantCode: string, roleId: number) {
  return executor.queryRows<AppRoleMapRow[]>(
    `SELECT app_role_code, sort_order
     FROM tenant_role_app_role_maps
     WHERE tenant_code = ?
       AND role_id = ?
     ORDER BY sort_order ASC, app_role_code ASC`,
    [tenantCode, roleId]
  )
}

async function loadSystemPermissions(executor: QueryExecutor, systemRoleId: number) {
  return executor.queryRows<PermissionRow[]>(
    `SELECT ar.role_code AS app_role_code,
            arp.app_code, arp.resource_code, arp.action, arp.manifest_action_id
     FROM platform_system_app_role_maps sarm
     INNER JOIN platform_app_roles ar
       ON ar.id = sarm.app_role_id
      AND ar.status = 'active'
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     WHERE sarm.system_role_id = ?
     ORDER BY ar.role_code ASC, arp.app_code ASC, arp.resource_code ASC, arp.action ASC`,
    [systemRoleId]
  )
}

async function loadSystemScopes(executor: QueryExecutor, systemRoleId: number) {
  return executor.queryRows<ScopeRow[]>(
    `SELECT ar.role_code AS app_role_code,
            ars.app_code, ars.resource_code, ars.action, ars.manifest_action_id,
            ars.scope_type, ars.scope_value, ars.status
     FROM platform_system_app_role_maps sarm
     INNER JOIN platform_app_roles ar
       ON ar.id = sarm.app_role_id
      AND ar.status = 'active'
     INNER JOIN platform_app_role_scopes ars
       ON ars.app_role_id = ar.id
      AND ars.status = 'active'
     WHERE sarm.system_role_id = ?
     ORDER BY ar.role_code ASC, ars.app_code ASC, ars.resource_code ASC, ars.action ASC, ars.scope_type ASC, ars.scope_value ASC`,
    [systemRoleId]
  )
}

async function loadTenantPermissions(executor: QueryExecutor, tenantCode: string, roleId: number) {
  return executor.queryRows<PermissionRow[]>(
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
       AND tram.role_id = ?
     ORDER BY app_code ASC, resource_code ASC, action ASC`,
    [tenantCode, roleId, tenantCode, roleId]
  )
}

async function loadTenantScopes(executor: QueryExecutor, tenantCode: string, roleId: number) {
  return executor.queryRows<ScopeRow[]>(
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
       AND tram.role_id = ?
     ORDER BY app_code ASC, resource_code ASC, action ASC, scope_type ASC, scope_value ASC`,
    [tenantCode, roleId, tenantCode, roleId]
  )
}

function diffAppRoleMaps(systemMaps: AppRoleMapRow[], tenantMaps: AppRoleMapRow[]) {
  const systemCodes = new Set(systemMaps.map(item => item.app_role_code))
  const tenantCodes = new Set(tenantMaps.map(item => item.app_role_code))

  return {
    missing: systemMaps
      .filter(item => !tenantCodes.has(item.app_role_code))
      .map(item => ({ appRoleCode: item.app_role_code, sortOrder: item.sort_order })),
    extra: tenantMaps
      .filter(item => !systemCodes.has(item.app_role_code))
      .map(item => ({ appRoleCode: item.app_role_code, sortOrder: item.sort_order }))
  }
}

function diffPermissions(systemPermissions: PermissionRow[], tenantPermissions: PermissionRow[]) {
  const systemMap = new Map(systemPermissions.map(item => [permissionKey(item), item]))
  const tenantMap = new Map(tenantPermissions.map(item => [permissionKey(item), item]))

  return {
    missing: systemPermissions
      .filter(item => !tenantMap.has(permissionKey(item)))
      .map(item => ({
        appRoleCode: item.app_role_code || null,
        appCode: item.app_code,
        resourceCode: item.resource_code,
        action: item.action,
        manifestActionId: item.manifest_action_id || null
      })),
    extra: tenantPermissions
      .filter(item => !systemMap.has(permissionKey(item)))
      .map(item => ({
        appCode: item.app_code,
        resourceCode: item.resource_code,
        action: item.action,
        sourceManifestActionId: item.source_manifest_action_id || null
      }))
  }
}

async function replaceTenantRoleAppRoleMaps(
  executor: QueryExecutor,
  tenantCode: string,
  roleId: number,
  systemRoleCode: string,
  maps: AppRoleMapRow[]
) {
  await executor.execute<ResultSetHeader>(
    `DELETE FROM tenant_role_app_role_maps
     WHERE tenant_code = ?
       AND role_id = ?`,
    [tenantCode, roleId]
  )

  for (const map of maps) {
    await executor.execute<ResultSetHeader>(
      `INSERT INTO tenant_role_app_role_maps
        (tenant_code, role_id, app_role_code, source_system_role_code, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [tenantCode, roleId, map.app_role_code, systemRoleCode, map.sort_order || 0]
    )
  }
}

export async function buildSystemRoleDiff(
  executor: QueryExecutor,
  tenantCodeInput: string,
  systemRoleCodeInput: string
) {
  const tenantCode = normalizeString(tenantCodeInput)
  const systemRoleCode = normalizeString(systemRoleCodeInput)
  if (!tenantCode || !systemRoleCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantCode and systemRoleCode are required'
    })
  }

  await ensureTenantExists(executor, tenantCode)
  const systemRole = await loadSystemRole(executor, systemRoleCode)
  const tenantRole = await loadTenantRoleBySource(executor, tenantCode, systemRole.role_code)
  const systemAppRoleMaps = await loadSystemAppRoleMaps(executor, systemRole.id)
  const tenantAppRoleMaps = tenantRole
    ? await loadTenantAppRoleMaps(executor, tenantCode, tenantRole.id)
    : []
  const systemPermissions = await loadSystemPermissions(executor, systemRole.id)
  const systemScopes = await loadSystemScopes(executor, systemRole.id)
  const tenantPermissions = tenantRole
    ? await loadTenantPermissions(executor, tenantCode, tenantRole.id)
    : []
  const tenantScopes = tenantRole
    ? await loadTenantScopes(executor, tenantCode, tenantRole.id)
    : []
  const appRoleMapDiff = diffAppRoleMaps(systemAppRoleMaps, tenantAppRoleMaps)
  const permissionDiff = diffPermissions(systemPermissions, tenantPermissions)

  return {
    tenantCode,
    systemRole: {
      id: systemRole.id,
      roleCode: systemRole.role_code,
      roleName: systemRole.role_name,
      roleType: systemRole.role_type,
      appCode: null,
      description: systemRole.description,
      isRequired: Boolean(systemRole.is_required),
      status: systemRole.status
    },
    tenantRole: mapTenantRole(tenantRole),
    appRoleMaps: appRoleMapDiff,
    permissions: permissionDiff,
    scopes: {
      missing: systemScopes.length > tenantScopes.length ? systemScopes.length - tenantScopes.length : 0,
      extra: tenantScopes.length > systemScopes.length ? tenantScopes.length - systemScopes.length : 0
    },
    summary: {
      appRoleMissingCount: appRoleMapDiff.missing.length,
      appRoleExtraCount: appRoleMapDiff.extra.length,
      permissionMissingCount: permissionDiff.missing.length,
      permissionExtraCount: permissionDiff.extra.length,
      permissionChangedCount: 0,
      scopeMissingCount: systemScopes.length > tenantScopes.length ? systemScopes.length - tenantScopes.length : 0,
      scopeExtraCount: tenantScopes.length > systemScopes.length ? tenantScopes.length - systemScopes.length : 0,
      scopeChangedCount: 0
    }
  }
}

export async function materializeSystemRole(executor: QueryExecutor, input: MaterializeInput) {
  const tenantCode = normalizeString(input.tenantCode)
  const systemRoleCode = normalizeString(input.systemRoleCode)
  const force = Boolean(input.force)

  if (!tenantCode || !systemRoleCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantCode and systemRoleCode are required'
    })
  }

  await ensureTenantExists(executor, tenantCode)
  const systemRole = await loadSystemRole(executor, systemRoleCode)
  const existing = await loadTenantRoleBySource(executor, tenantCode, systemRole.role_code)
  const diff = await buildSystemRoleDiff(executor, tenantCode, systemRole.role_code)
  const systemPolicy = await refreshEnterpriseSystemRolePolicySnapshot(executor, systemRole.id)

  if (existing && (existing.source !== 'system' || existing.source_role_code !== systemRole.role_code)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `tenant role code already exists and is not linked to system role: roleCode=${systemRole.role_code}`
    })
  }

  if (existing && existing.is_overridden && !force) {
    return {
      applied: false,
      requiresConfirmation: true,
      reason: 'tenant role is overridden; pass force=true to merge system defaults',
      diff,
      tenantRole: mapTenantRole(existing)
    }
  }

  let roleId = existing?.id || 0

  if (!existing) {
    const result = await executor.execute<ResultSetHeader>(
      `INSERT INTO tenant_roles
        (tenant_code, role_code, role_name, role_type, app_code, description,
         source, source_role_code, source_manifest_id, is_overridden, is_assignable, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'system', ?, NULL, 0, 1, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        tenantCode,
        systemRole.role_code,
        systemRole.role_name,
        TENANT_SYSTEM_ROLE_TYPE,
        systemRole.description,
        systemRole.role_code
      ]
    )
    roleId = result.insertId
  } else {
    await executor.execute<ResultSetHeader>(
      `UPDATE tenant_roles
       SET role_name = ?,
           role_type = ?,
           app_code = NULL,
           description = ?,
           source = 'system',
           source_role_code = ?,
           source_manifest_id = NULL,
           is_overridden = 0,
           is_assignable = 1,
           status = 'active',
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        systemRole.role_name,
        TENANT_SYSTEM_ROLE_TYPE,
        systemRole.description,
        systemRole.role_code,
        existing.id
      ]
    )
  }

  const systemAppRoleMaps = await loadSystemAppRoleMaps(executor, systemRole.id)
  await replaceTenantRoleAppRoleMaps(executor, tenantCode, roleId, systemRole.role_code, systemAppRoleMaps)
  await refreshTenantRolePolicySnapshot(executor, tenantCode, roleId, {
    sourcePolicyHash: systemPolicy.policyHash,
    isOverridden: false
  })

  const tenantRole = await loadTenantRoleBySource(executor, tenantCode, systemRole.role_code)
  const systemPermissions = await loadSystemPermissions(executor, systemRole.id)
  const systemScopes = await loadSystemScopes(executor, systemRole.id)

  return {
    applied: true,
    requiresConfirmation: false,
    diff,
    tenantRole: mapTenantRole(tenantRole),
    appRoleCount: systemAppRoleMaps.length,
    permissionCount: systemPermissions.length,
    scopeCount: systemScopes.length
  }
}
