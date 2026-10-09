import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { createError } from 'h3'
import { parseRecommendedRoles, type ManifestRecommendedRole } from './manifestRoleDefinition.ts'
import type {
  ManifestPermission
} from '~~/server/utils/appManifestPermission'
import { refreshSystemRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'

export interface ManifestRoleMaterializationResult {
  roleCount: number
  permissionCount: number
}

type QueryExecutor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

interface SystemRoleRow extends RowDataPacket {
  id: number
  app_code: string | null
}

interface AppRoleIdRow extends RowDataPacket {
  id: number
}

interface ManifestActionRow extends RowDataPacket {
  id: number
  app_code: string
  resource_code: string
  action: string
}

async function resolveManifestAction(
  executor: QueryExecutor,
  manifestId: number,
  permission: ManifestPermission,
  roleCode: string
) {
  const row = await executor.queryRow<ManifestActionRow>(
    `SELECT mra.id, mra.app_code, mra.resource_code, mra.action
     FROM platform_app_manifest_resource_actions mra
     INNER JOIN platform_app_manifest_resources mr
       ON mr.id = mra.manifest_resource_id
      AND mr.manifest_id = mra.manifest_id
      AND mr.app_code = mra.app_code
      AND mr.resource_code = mra.resource_code
     WHERE mra.manifest_id = ?
       AND mra.app_code = ?
       AND mra.resource_code = ?
       AND mra.action = ?
       AND mra.status = 'active'
       AND mr.status = 'active'
     LIMIT 1`,
    [manifestId, permission.appCode, permission.resourceCode, permission.action]
  )

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `manifest action not found for ${roleCode}: ${permission.appCode}:${permission.resourceCode}:${permission.action}`
    })
  }

  return row
}

async function upsertSystemRole(executor: QueryExecutor, appCode: string, role: ManifestRecommendedRole) {
  const existing = await executor.queryRow<SystemRoleRow>(
    `SELECT id, app_code
     FROM platform_app_roles
     WHERE role_code = ?
     LIMIT 1`,
    [role.roleCode]
  )

  if (existing?.app_code && existing.app_code !== appCode) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `system role code already belongs to appCode=${existing.app_code}: roleCode=${role.roleCode}`
    })
  }

  if (existing?.id) {
    await executor.execute<ResultSetHeader>(
      `UPDATE platform_app_roles
       SET role_name = ?,
           role_type = 'app',
           app_code = ?,
           description = ?,
           status = 'active',
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [role.roleName, appCode, role.description, existing.id]
    )
    return Number(existing.id)
  }

  const inserted = await executor.execute<ResultSetHeader>(
    `INSERT INTO platform_app_roles
      (role_code, role_name, role_type, app_code, description, is_required, status, created_at, updated_at)
     VALUES (?, ?, 'app', ?, ?, 0, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [role.roleCode, role.roleName, appCode, role.description]
  )

  return Number(inserted.insertId)
}

async function deactivateObsoleteAppRoles(
  executor: QueryExecutor,
  appCode: string,
  roles: ManifestRecommendedRole[]
) {
  const roleCodes = roles.map(role => role.roleCode)
  const params: Array<string | number> = [appCode]
  let roleFilter = ''

  if (roleCodes.length) {
    roleFilter = `AND role_code NOT IN (${roleCodes.map(() => '?').join(', ')})`
    params.push(...roleCodes)
  }

  const obsoleteRoles = await executor.queryRows<AppRoleIdRow[]>(
    `SELECT id
     FROM platform_app_roles
     WHERE app_code = ?
       AND status = 'active'
       ${roleFilter}`,
    params
  )

  if (!obsoleteRoles.length) {
    return
  }

  await executor.execute<ResultSetHeader>(
    `UPDATE platform_app_roles
     SET status = 'inactive',
         updated_at = UTC_TIMESTAMP()
     WHERE app_code = ?
       AND status = 'active'
       ${roleFilter}`,
    params
  )

  for (const role of obsoleteRoles) {
    await refreshSystemRolePolicySnapshot(executor, Number(role.id))
  }
}

export async function materializeRecommendedRolesFromManifest(
  executor: QueryExecutor,
  input: {
    appCode: string
    manifestId: number
    manifestJson: Record<string, unknown>
  }
): Promise<ManifestRoleMaterializationResult> {
  const roles = parseRecommendedRoles(input.appCode, input.manifestJson)
  let permissionCount = 0
  if (roles.some(role => role.defaultScopes !== undefined)) {
    const installed = await executor.queryRow<RowDataPacket>(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = \'platform_app_role_scopes\' AND COLUMN_NAME = \'source_type\'',
      []
    )
    if (!installed) throw createError({ statusCode: 503, message: 'Manifest default scopes require the platform_app_role_scopes.source_type migration', data: { code: 'manifest_default_scope_migration_required' } })
  }

  for (const role of roles) {
    const roleId = await upsertSystemRole(executor, input.appCode, role)

    await executor.execute<ResultSetHeader>(
      'DELETE FROM platform_app_role_permissions WHERE app_role_id = ?',
      [roleId]
    )

    const manifestActions = new Map<string, ManifestActionRow>()
    const seenPermissions = new Set<string>()
    for (const permission of role.permissions) {
      const permissionKey = `${permission.appCode}:${permission.resourceCode}:${permission.action}`
      if (seenPermissions.has(permissionKey)) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Conflict',
          message: `duplicate suggested permission in ${role.roleCode}: ${permissionKey}`
        })
      }
      seenPermissions.add(permissionKey)

      const manifestAction = await resolveManifestAction(executor, input.manifestId, permission, role.roleCode)
      await executor.execute<ResultSetHeader>(
        `INSERT INTO platform_app_role_permissions
          (app_role_id, app_code, resource_code, action, manifest_action_id, created_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [roleId, manifestAction.app_code, manifestAction.resource_code, manifestAction.action, manifestAction.id]
      )
      manifestActions.set(permissionKey, manifestAction)
      permissionCount += 1
    }

    if (role.defaultScopes !== undefined) {
      const desired = new Set(role.defaultScopes.map(scope => JSON.stringify([scope.appCode, scope.resourceCode, scope.action, scope.scopeType, scope.scopeValue])))
      const existing = await executor.queryRows<RowDataPacket[]>(
        'SELECT id, app_code, resource_code, action, scope_type, scope_value FROM platform_app_role_scopes WHERE app_role_id = ? AND source_type = \'manifest_default\'',
        [roleId]
      )
      for (const scope of existing) {
        if (desired.has(JSON.stringify([scope.app_code, scope.resource_code, scope.action, scope.scope_type, scope.scope_value]))) continue
        await executor.execute<ResultSetHeader>(
          'DELETE FROM platform_app_role_scopes WHERE id = ? AND app_role_id = ? AND source_type = \'manifest_default\'',
          [scope.id, roleId]
        )
      }
      for (const scope of role.defaultScopes) {
        const action = manifestActions.get(`${scope.appCode}:${scope.resourceCode}:${scope.action}`)!
        // The existing unique tuple also covers manual rows: a collision is a
        // no-op for manual rows, never activation, reattribution or deletion.
        await executor.execute<ResultSetHeader>(
          `INSERT INTO platform_app_role_scopes
            (app_role_id, app_code, resource_code, action, manifest_action_id, scope_type, scope_value, source_type, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'manifest_default', 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE
             manifest_action_id = IF(source_type = 'manifest_default', VALUES(manifest_action_id), manifest_action_id),
             status = IF(source_type = 'manifest_default', 'active', status)`,
          [roleId, action.app_code, action.resource_code, action.action, action.id, scope.scopeType, scope.scopeValue]
        )
      }
    }

    await refreshSystemRolePolicySnapshot(executor, roleId)
  }

  await deactivateObsoleteAppRoles(executor, input.appCode, roles)

  return {
    roleCount: roles.length,
    permissionCount
  }
}
