import type { RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows } from '~~/server/utils/db'
import { ACTION_ORDER } from '~~/server/utils/permissionActions'
import { actionSatisfies, type AuthorizationMode } from '@hzy/authz-core'
import {
  buildAuthorizationSnapshotWithQueries,
  type AuthorizationQueryAdapter
} from './authorizationSnapshotBuilder'
import {
  buildDbAuthorizationGrantsWithQueries,
  evaluateDbAuthorizationWithQueries,
  type DbAuthorizationEvaluateInput,
  type DbAuthorizationExplainInput,
  explainDbAuthorizationWithQueries,
  type DbAuthorizationGrantOptions
} from './authorizationGrants'

export interface AuthorizationRole {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  source: {
    type: string
    id: string | number | null
  }
}

export interface AuthorizationPermission {
  appCode: string
  resourceCode: string
  action: string
}

export interface AuthorizationScope {
  appCode: string
  resourceCode: string
  action: string
  scopeType: string
  scopeValue: string
}

export interface AuthorizationSnapshot {
  uid: string
  tenantCode: string
  roles: AuthorizationRole[]
  availableRoles?: AuthorizationRole[]
  activeRoleCode?: string | null
  permissions: AuthorizationPermission[]
  scopes: AuthorizationScope[]
  sources: Array<{ type: string, id: string | number | null }>
}

export interface AuthorizationSnapshotOptions {
  activeRoleCode?: string | null
  authorizationMode?: AuthorizationMode | string | null
  allowRoleSimulation?: boolean
  allowUserSimulation?: boolean
  allowPrivileged?: boolean
}

interface AccountRoleRow extends RowDataPacket {
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  source_type: string
  source_id: string | null
}

interface TenantMembershipRow extends RowDataPacket {
  is_owner: number
}

interface PermissionRow extends RowDataPacket {
  role_id: number
  app_code: string
  resource_code: string
  action: string
}

interface ScopeRow extends RowDataPacket {
  role_id: number
  app_code: string
  resource_code: string
  action: string
  scope_type: string
  scope_value: string
}

const ENTERPRISE_TENANT_ROLE_SQL = `
       AND tr.app_code IS NULL
       AND tr.status = 'active'
       AND tr.is_assignable = 1`

const authorizationQueries: AuthorizationQueryAdapter = { queryRow, queryRows }

export async function buildTenantAccountAuthorizationSnapshot(
  tenantCode: string,
  accountId: number,
  uid: string,
  appCode?: string | null
): Promise<AuthorizationSnapshot> {
  const membership = await queryRow<TenantMembershipRow>(
    `SELECT is_owner
     FROM tenant_account_memberships
     WHERE tenant_code = ?
       AND account_id = ?
       AND status = 'active'
     LIMIT 1`,
    [tenantCode, accountId]
  )

  if (!membership) {
    return {
      uid,
      tenantCode,
      roles: [],
      permissions: [],
      scopes: [],
      sources: []
    }
  }

  const accountRoles = await queryRows<AccountRoleRow[]>(
    `SELECT tr.id AS role_id, tr.role_code, tr.role_name, tr.role_type, tr.app_code, tar.source_type, tar.source_id
     FROM tenant_account_roles tar
     INNER JOIN tenant_roles tr
       ON tr.id = tar.role_id
      AND tr.tenant_code = tar.tenant_code
     WHERE tar.tenant_code = ?
       AND tar.account_id = ?
       AND tar.status = 'active'
       AND (tar.starts_at IS NULL OR tar.starts_at <= UTC_TIMESTAMP())
       AND (tar.expired_at IS NULL OR tar.expired_at > UTC_TIMESTAMP())
       AND tr.status = 'active'
       ${ENTERPRISE_TENANT_ROLE_SQL}`,
    [tenantCode, accountId]
  )

  const roleMap = new Map<number, AuthorizationRole>()

  for (const role of accountRoles) {
    roleMap.set(role.role_id, {
      roleCode: role.role_code,
      roleName: role.role_name,
      roleType: role.role_type,
      appCode: role.app_code,
      source: {
        type: role.source_type,
        id: role.source_id
      }
    })
  }

  const roleIds = [...roleMap.keys()]
  if (!roleIds.length) {
    return {
      uid,
      tenantCode,
      roles: [],
      permissions: [],
      scopes: [],
      sources: []
    }
  }

  const inPlaceholders = roleIds.map(() => '?').join(', ')
  const permissions = await queryRows<PermissionRow[]>(
    `SELECT role_id, app_code, resource_code, action
     FROM tenant_role_permissions
     WHERE tenant_code = ?
       AND role_id IN (${inPlaceholders})
       ${appCode ? 'AND app_code = ?' : ''}
     UNION ALL
     SELECT tram.role_id, arp.app_code, arp.resource_code, arp.action
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     WHERE tram.tenant_code = ?
       AND tram.role_id IN (${inPlaceholders})
       ${appCode ? 'AND arp.app_code = ?' : ''}`,
    appCode
      ? [tenantCode, ...roleIds, appCode, tenantCode, ...roleIds, appCode]
      : [tenantCode, ...roleIds, tenantCode, ...roleIds]
  )

  const scopes = await queryRows<ScopeRow[]>(
    `SELECT role_id, app_code, resource_code, action, scope_type, scope_value
     FROM tenant_role_scopes
     WHERE tenant_code = ?
       AND role_id IN (${inPlaceholders})
       AND status = 'active'
       ${appCode ? 'AND app_code = ?' : ''}
     UNION ALL
     SELECT tram.role_id, ars.app_code, ars.resource_code, ars.action, ars.scope_type, ars.scope_value
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
     INNER JOIN platform_app_role_scopes ars
       ON ars.app_role_id = ar.id
      AND ars.status = 'active'
     WHERE tram.tenant_code = ?
       AND tram.role_id IN (${inPlaceholders})
       ${appCode ? 'AND ars.app_code = ?' : ''}`,
    appCode
      ? [tenantCode, ...roleIds, appCode, tenantCode, ...roleIds, appCode]
      : [tenantCode, ...roleIds, tenantCode, ...roleIds]
  )

  return {
    uid,
    tenantCode,
    roles: [...roleMap.values()].sort((a, b) => a.roleCode.localeCompare(b.roleCode)),
    permissions: permissions.map(permission => ({
      appCode: permission.app_code,
      resourceCode: permission.resource_code,
      action: permission.action
    })),
    scopes: scopes.map(scope => ({
      appCode: scope.app_code,
      resourceCode: scope.resource_code,
      action: scope.action,
      scopeType: scope.scope_type,
      scopeValue: scope.scope_value
    })),
    sources: [...roleMap.values()].map(role => role.source)
  }
}

export async function buildAuthorizationSnapshot(
  tenantCode: string,
  uid: string,
  appCode?: string | null,
  options: AuthorizationSnapshotOptions = {}
): Promise<AuthorizationSnapshot> {
  return buildAuthorizationSnapshotWithQueries(authorizationQueries, tenantCode, uid, appCode, options)
}

export async function buildDbAuthorizationGrants(
  tenantCode: string,
  uid: string,
  appCode?: string | null,
  options: DbAuthorizationGrantOptions = {}
) {
  return buildDbAuthorizationGrantsWithQueries(authorizationQueries, tenantCode, uid, appCode, options)
}

export async function evaluateDbAuthorization(
  tenantCode: string,
  uid: string,
  appCode: string,
  input: DbAuthorizationEvaluateInput
) {
  return evaluateDbAuthorizationWithQueries(authorizationQueries, tenantCode, uid, appCode, input)
}

export async function explainDbAuthorization(
  tenantCode: string,
  uid: string,
  appCode: string,
  input: DbAuthorizationExplainInput
) {
  return explainDbAuthorizationWithQueries(authorizationQueries, tenantCode, uid, appCode, input)
}

export async function checkPermission(
  tenantCode: string,
  uid: string,
  appCode: string,
  resourceCode: string,
  action: string,
  options: AuthorizationSnapshotOptions = {}
) {
  const snapshot = await buildAuthorizationSnapshot(tenantCode, uid, appCode, options)

  const matchedPermissions = snapshot.permissions.filter(permission =>
    permission.appCode === appCode
    && permission.resourceCode === resourceCode
    && actionSatisfies(permission.action, action)
  )

  const strongestAction = matchedPermissions
    .map(permission => permission.action)
    .sort((left, right) => ACTION_ORDER.indexOf(right as typeof ACTION_ORDER[number]) - ACTION_ORDER.indexOf(left as typeof ACTION_ORDER[number]))[0]

  const matchedScopes = snapshot.scopes.filter(scope =>
    scope.appCode === appCode
    && scope.resourceCode === resourceCode
    && actionSatisfies(scope.action, action)
  )

  const matchedRoles = snapshot.roles
    .filter(role => !role.appCode || role.appCode === appCode)
    .map(role => role.roleCode)

  return {
    allowed: matchedPermissions.length > 0,
    matchedAction: strongestAction || null,
    roles: [...new Set(matchedRoles)],
    scopes: matchedScopes.map(scope => ({
      scopeType: scope.scopeType,
      scopeValue: scope.scopeValue
    })),
    snapshot
  }
}
