import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { refreshTenantRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'
import { requireTenantOwnerForTenantAdmin } from '~~/server/utils/tenantAdminAccess'

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  description: string | null
  source: string
  is_assignable: number
  status: string
  created_at: string
  updated_at: string
}

interface AppRoleMapRow extends RowDataPacket {
  app_role_code: string
  sort_order: number
}

interface PermissionRow extends RowDataPacket {
  app_code: string
  resource_code: string
  action: string
  source_manifest_action_id: number | null
}

interface ScopeRow extends RowDataPacket {
  app_code: string
  resource_code: string
  action: string
  source_manifest_action_id: number | null
  scope_type: string
  scope_value: string
  status: string
}

const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'id is invalid'
    })
  }

  return id
}

function requireAllowedStatus(value: string) {
  if (!ALLOWED_STATUSES.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `status must be one of: ${Array.from(ALLOWED_STATUSES).join(', ')}`
    })
  }

  return value
}

function copiedDescription(body: Record<string, unknown>, sourceRole: RoleRow) {
  if (body.description !== undefined) {
    return normalizeNullableString(body.description)
  }

  return sourceRole.description || `Copied from ${sourceRole.role_code}`
}

export default defineEventHandler(async (event) => {
  const sourceRoleId = requireId(event)
  requireTenantOwnerForTenantAdmin(event, 'only tenant owner can copy tenant roles')

  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const roleCode = requireString(body.roleCode, 'roleCode')
  const roleName = requireString(body.roleName, 'roleName')
  const status = requireAllowedStatus(normalizeNullableString(body.status) || 'active')
  const isAssignable = body.isAssignable === undefined ? true : Boolean(body.isAssignable)

  const result = await withTransaction(async (tx) => {
    const sourceRole = await tx.queryRow<RoleRow>(
      `SELECT id, tenant_code, role_code, role_name, role_type, app_code, description,
              source, is_assignable, status, created_at, updated_at
       FROM tenant_roles
       WHERE id = ?
         AND tenant_code = ?
       LIMIT 1`,
      [sourceRoleId, tenantCode]
    )

    if (!sourceRole) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `source tenant role not found: id=${sourceRoleId}`
      })
    }

    if (sourceRole.source !== 'system' && sourceRole.role_type !== 'system') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'only platform inherited roles can be copied to custom roles'
      })
    }

    const existing = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM tenant_roles
       WHERE tenant_code = ?
         AND role_code = ?
       LIMIT 1`,
      [tenantCode, roleCode]
    )

    if (existing) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `role already exists: tenantCode=${tenantCode}, roleCode=${roleCode}`
      })
    }

    const insertResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_roles
        (tenant_code, role_code, role_name, role_type, app_code, description,
         parent_id, source, source_role_code, is_overridden, is_assignable, status, created_at, updated_at)
       VALUES (?, ?, ?, 'custom', NULL, ?, ?, 'custom', ?, 0, ?, ?, NOW(), NOW())`,
      [
        tenantCode,
        roleCode,
        roleName,
        copiedDescription(body, sourceRole),
        sourceRole.id,
        sourceRole.role_code,
        isAssignable ? 1 : 0,
        status
      ]
    )
    const newRoleId = insertResult.insertId

    const appRoleMaps = await tx.queryRows<AppRoleMapRow[]>(
      `SELECT app_role_code, sort_order
       FROM tenant_role_app_role_maps
       WHERE tenant_code = ?
         AND role_id = ?
       ORDER BY sort_order ASC, app_role_code ASC`,
      [tenantCode, sourceRole.id]
    )

    for (const [index, item] of appRoleMaps.entries()) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_role_app_role_maps
          (tenant_code, role_id, app_role_code, source_system_role_code, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, NOW(), NOW())`,
        [tenantCode, newRoleId, item.app_role_code, Number(item.sort_order ?? index)]
      )
    }

    const permissions = await tx.queryRows<PermissionRow[]>(
      `SELECT app_code, resource_code, action, source_manifest_action_id
       FROM tenant_role_permissions
       WHERE tenant_code = ?
         AND role_id = ?
       ORDER BY app_code ASC, resource_code ASC, action ASC`,
      [tenantCode, sourceRole.id]
    )

    for (const permission of permissions) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_role_permissions
          (tenant_code, role_id, app_code, resource_code, action, source_manifest_action_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [tenantCode, newRoleId, permission.app_code, permission.resource_code, permission.action, permission.source_manifest_action_id]
      )
    }

    const scopes = await tx.queryRows<ScopeRow[]>(
      `SELECT app_code, resource_code, action, source_manifest_action_id, scope_type, scope_value, status
       FROM tenant_role_scopes
       WHERE tenant_code = ?
         AND role_id = ?
       ORDER BY app_code ASC, resource_code ASC, action ASC, scope_type ASC, scope_value ASC`,
      [tenantCode, sourceRole.id]
    )

    for (const scope of scopes) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_role_scopes
          (tenant_code, role_id, app_code, resource_code, action, source_manifest_action_id,
           scope_type, scope_value, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          tenantCode,
          newRoleId,
          scope.app_code,
          scope.resource_code,
          scope.action,
          scope.source_manifest_action_id,
          scope.scope_type,
          scope.scope_value,
          scope.status
        ]
      )
    }

    await refreshTenantRolePolicySnapshot(tx, tenantCode, newRoleId)

    const role = await tx.queryRow<RoleRow>(
      `SELECT id, tenant_code, role_code, role_name, role_type, app_code, description,
              source, is_assignable, status, created_at, updated_at
       FROM tenant_roles
       WHERE id = ?
       LIMIT 1`,
      [newRoleId]
    )

    if (!role) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'failed to load copied role'
      })
    }

    return {
      sourceRole,
      role,
      copied: {
        appRoles: appRoleMaps.length,
        permissions: permissions.length,
        scopes: scopes.length
      }
    }
  })

  return ok({
    role: {
      id: result.role.id,
      tenantCode: result.role.tenant_code,
      roleCode: result.role.role_code,
      roleName: result.role.role_name,
      roleType: result.role.role_type,
      appCode: result.role.app_code,
      description: result.role.description,
      isSystem: false,
      isAssignable: Boolean(result.role.is_assignable),
      status: result.role.status,
      createdAt: result.role.created_at,
      updatedAt: result.role.updated_at
    },
    copiedFrom: {
      id: result.sourceRole.id,
      roleCode: result.sourceRole.role_code,
      roleName: result.sourceRole.role_name
    },
    copied: result.copied
  })
})
