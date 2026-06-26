import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { refreshSystemRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'

export type SystemRoleScope = 'platform' | 'tenant' | 'app'

export type QueryExecutor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

export interface SystemPermissionInput {
  appCode?: unknown
  resourceCode?: unknown
  action?: unknown
  manifestActionId?: unknown
}

export interface SystemScopeInput extends SystemPermissionInput {
  scopeType?: unknown
  scopeValue?: unknown
  status?: unknown
}

interface ManifestActionRow extends RowDataPacket {
  id: number
  app_code: string
  resource_code: string
  action: string
}

export const SYSTEM_ROLE_STATUSES = new Set(['active', 'suspended', 'disabled'])
const TENANT_ROLE_TYPES = new Set(['system', 'base', 'tenant'])
const SCOPE_STATUSES = new Set(['active', 'disabled'])

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

export function requireSystemRoleScope(value: unknown): SystemRoleScope {
  const normalized = normalizeString(value)
  if (normalized === 'platform' || normalized === 'tenant' || normalized === 'app') {
    return normalized
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'scope must be one of: platform, tenant, app'
  })
}

export function requireAllowedValue(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return value
}

export function resolveSystemRoleScope(roleType: string, appCode: string | null): SystemRoleScope {
  const normalizedRoleType = normalizeString(roleType).toLowerCase()
  if (!appCode || normalizedRoleType === 'platform') {
    return 'platform'
  }

  if (TENANT_ROLE_TYPES.has(normalizedRoleType)) {
    return 'tenant'
  }

  return 'app'
}

export function defaultSystemRoleType(scope: SystemRoleScope) {
  if (scope === 'platform') return 'platform'
  if (scope === 'tenant') return 'system'
  return 'app'
}

export async function ensureApplicationExists(executor: QueryExecutor, appCode: string) {
  const app = await executor.queryRow<RowDataPacket>(
    `SELECT app_code
     FROM platform_applications
     WHERE app_code = ?
     LIMIT 1`,
    [appCode]
  )

  if (!app) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `application not found: appCode=${appCode}`
    })
  }
}

async function resolveManifestAction(executor: QueryExecutor, input: {
  appCode: string
  resourceCode: string
  action: string
  manifestActionId?: number | null
}) {
  const params = input.manifestActionId
    ? [input.manifestActionId, input.appCode, input.resourceCode, input.action]
    : [input.appCode, input.resourceCode, input.action]

  const row = await executor.queryRow<ManifestActionRow>(
    `SELECT mra.id, mra.app_code, mra.resource_code, mra.action
     FROM platform_applications pa
     INNER JOIN platform_app_manifests pam
       ON pam.id = COALESCE(
         (SELECT par.manifest_id
          FROM platform_app_releases par
          WHERE par.id = pa.latest_release_id
            AND par.app_code = pa.app_code
          LIMIT 1),
         pa.latest_manifest_id
       )
      AND pam.app_code = pa.app_code
     INNER JOIN platform_app_manifest_resource_actions mra
       ON mra.app_code = pam.app_code
      AND mra.manifest_id = pam.id
     INNER JOIN platform_app_manifest_resources mr
       ON mr.id = mra.manifest_resource_id
      AND mr.manifest_id = mra.manifest_id
      AND mr.app_code = mra.app_code
      AND mr.resource_code = mra.resource_code
     WHERE ${input.manifestActionId ? 'mra.id = ? AND' : ''} mra.app_code = ?
       AND mra.resource_code = ?
       AND mra.action = ?
       AND mra.status = 'active'
       AND mr.status = 'active'
     LIMIT 1`,
    params
  )

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `manifest action not found: ${input.appCode}.${input.resourceCode}.${input.action}`
    })
  }

  return row
}

function preparePermissionInput(item: SystemPermissionInput, index: number) {
  const appCode = normalizeString(item.appCode)
  const resourceCode = normalizeString(item.resourceCode)
  const action = normalizeString(item.action)
  const manifestActionIdRaw = Number(item.manifestActionId || 0)
  const manifestActionId = Number.isInteger(manifestActionIdRaw) && manifestActionIdRaw > 0
    ? manifestActionIdRaw
    : null

  if (!appCode || !resourceCode || !action) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `permissions[${index}] requires appCode/resourceCode/action`
    })
  }

  return {
    appCode,
    resourceCode,
    action,
    manifestActionId
  }
}

function prepareScopeInput(item: SystemScopeInput, index: number) {
  const permission = preparePermissionInput(item, index)
  const scopeType = normalizeString(item.scopeType)
  const scopeValue = normalizeString(item.scopeValue)
  const status = requireAllowedValue(normalizeString(item.status) || 'active', `scopes[${index}].status`, SCOPE_STATUSES)

  if (!scopeType || !scopeValue) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `scopes[${index}] requires scopeType/scopeValue`
    })
  }

  return {
    ...permission,
    scopeType,
    scopeValue,
    status
  }
}

export async function replaceSystemRolePermissions(
  executor: QueryExecutor,
  systemRoleId: number,
  permissions: SystemPermissionInput[]
) {
  const prepared = permissions.map(preparePermissionInput)
  const uniqueKeys = new Set<string>()

  for (const permission of prepared) {
    const key = `${permission.appCode}::${permission.resourceCode}::${permission.action}`
    if (uniqueKeys.has(key)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `duplicate permission entry: ${key}`
      })
    }
    uniqueKeys.add(key)
  }

  await executor.execute<ResultSetHeader>(
    'DELETE FROM platform_app_role_permissions WHERE app_role_id = ?',
    [systemRoleId]
  )

  const resolvedPermissions: Array<{ appCode: string, resourceCode: string, action: string, manifestActionId: number }> = []

  for (const permission of prepared) {
    const manifestAction = await resolveManifestAction(executor, permission)
    await executor.execute<ResultSetHeader>(
      `INSERT INTO platform_app_role_permissions
        (app_role_id, app_code, resource_code, action, manifest_action_id, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [systemRoleId, manifestAction.app_code, manifestAction.resource_code, manifestAction.action, manifestAction.id]
    )

    resolvedPermissions.push({
      appCode: manifestAction.app_code,
      resourceCode: manifestAction.resource_code,
      action: manifestAction.action,
      manifestActionId: manifestAction.id
    })
  }

  await refreshSystemRolePolicySnapshot(executor, systemRoleId)

  return resolvedPermissions
}

export async function replaceSystemRoleScopes(
  executor: QueryExecutor,
  systemRoleId: number,
  scopes: SystemScopeInput[]
) {
  const prepared = scopes.map(prepareScopeInput)
  const uniqueKeys = new Set<string>()

  for (const scope of prepared) {
    const key = `${scope.appCode}::${scope.resourceCode}::${scope.action}::${scope.scopeType}::${scope.scopeValue}`
    if (uniqueKeys.has(key)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `duplicate scope entry: ${key}`
      })
    }
    uniqueKeys.add(key)
  }

  await executor.execute<ResultSetHeader>(
    'DELETE FROM platform_app_role_scopes WHERE app_role_id = ?',
    [systemRoleId]
  )

  const resolvedScopes: Array<{
    appCode: string
    resourceCode: string
    action: string
    manifestActionId: number
    scopeType: string
    scopeValue: string
    status: string
  }> = []

  for (const scope of prepared) {
    const manifestAction = await resolveManifestAction(executor, scope)
    await executor.execute<ResultSetHeader>(
      `INSERT INTO platform_app_role_scopes
        (app_role_id, app_code, resource_code, action, manifest_action_id, scope_type, scope_value, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        systemRoleId,
        manifestAction.app_code,
        manifestAction.resource_code,
        manifestAction.action,
        manifestAction.id,
        scope.scopeType,
        scope.scopeValue,
        scope.status
      ]
    )

    resolvedScopes.push({
      appCode: manifestAction.app_code,
      resourceCode: manifestAction.resource_code,
      action: manifestAction.action,
      manifestActionId: manifestAction.id,
      scopeType: scope.scopeType,
      scopeValue: scope.scopeValue,
      status: scope.status
    })
  }

  await refreshSystemRolePolicySnapshot(executor, systemRoleId)

  return resolvedScopes
}

export async function loadSystemRoleId(executor: QueryExecutor, roleCode: string) {
  const role = await executor.queryRow<RowDataPacket & { id: number }>(
    `SELECT id
     FROM platform_app_roles
     WHERE role_code = ?
     LIMIT 1`,
    [roleCode]
  )

  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `app role not found: roleCode=${roleCode}`
    })
  }

  return Number(role.id)
}
