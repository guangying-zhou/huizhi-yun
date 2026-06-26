import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { createError } from 'h3'
import {
  parseManifestPermissionString,
  type ManifestPermission
} from '~~/server/utils/appManifestPermission'
import { refreshSystemRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'

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

interface ManifestRecommendedRole {
  roleCode: string
  roleName: string
  description: string | null
  permissions: ManifestPermission[]
}

export interface ManifestRoleMaterializationResult {
  roleCount: number
  permissionCount: number
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseSuggestedPermission(value: unknown, appCode: string, roleCode: string, index: number): ManifestPermission {
  if (typeof value === 'string') {
    return parseManifestPermissionString(value, appCode, roleCode, index)
  }

  const record = asRecord(value)
  const permissionAppCode = normalizeString(record?.appCode) || appCode
  const resourceCode = normalizeString(record?.resourceCode)
  const action = normalizeString(record?.action)

  if (!record || !permissionAppCode || !resourceCode || !action) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `recommendedRoles[${roleCode}].suggestedPermissions[${index}] requires appCode/resourceCode/action`
    })
  }

  if (permissionAppCode !== appCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `recommendedRoles[${roleCode}].suggestedPermissions[${index}] appCode mismatch: expected ${appCode}, got ${permissionAppCode}`
    })
  }

  return { appCode: permissionAppCode, resourceCode, action }
}

function parseRecommendedRoles(appCode: string, manifestJson: Record<string, unknown>) {
  const rawRoles = manifestJson.recommendedRoles
  if (!Array.isArray(rawRoles)) {
    return []
  }

  return rawRoles.map((rawRole, roleIndex) => {
    const record = asRecord(rawRole)
    const roleCode = normalizeString(record?.code)
    if (!record || !roleCode) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `recommendedRoles[${roleIndex}].code is required`
      })
    }

    if (!roleCode.startsWith(`${appCode}:`)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `recommendedRoles[${roleIndex}].code must start with ${appCode}:`
      })
    }

    const rawPermissions = record.suggestedPermissions
    const permissions = Array.isArray(rawPermissions)
      ? rawPermissions.map((permission, permissionIndex) =>
          parseSuggestedPermission(permission, appCode, roleCode, permissionIndex)
        )
      : []

    return {
      roleCode,
      roleName: normalizeString(record.name) || roleCode,
      description: normalizeString(record.description) || null,
      permissions
    } satisfies ManifestRecommendedRole
  })
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

  for (const role of roles) {
    const roleId = await upsertSystemRole(executor, input.appCode, role)

    await executor.execute<ResultSetHeader>(
      'DELETE FROM platform_app_role_permissions WHERE app_role_id = ?',
      [roleId]
    )

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
      permissionCount += 1
    }

    await refreshSystemRolePolicySnapshot(executor, roleId)
  }

  await deactivateObsoleteAppRoles(executor, input.appCode, roles)

  return {
    roleCount: roles.length,
    permissionCount
  }
}
