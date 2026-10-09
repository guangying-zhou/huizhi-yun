import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'

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

const ALLOWED_ROLE_TYPES = new Set(['system', 'custom'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return value
}

async function loadRole(id: number) {
  return queryRow<RoleRow>(
    `SELECT id, tenant_code, role_code, role_name, role_type, app_code, description,
            source, is_assignable, status, created_at, updated_at
     FROM tenant_roles
     WHERE id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const roleCode = requireString(body.roleCode, 'roleCode')
  const roleName = requireString(body.roleName, 'roleName')
  const roleType = requireAllowed(normalizeNullableString(body.roleType) || 'custom', 'roleType', ALLOWED_ROLE_TYPES)
  const description = normalizeNullableString(body.description)
  const isAssignable = body.isAssignable === undefined ? true : Boolean(body.isAssignable)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)

  const tenant = await queryRow<RowDataPacket>(
    `SELECT id FROM tenants WHERE tenant_code = ? LIMIT 1`,
    [tenantCode]
  )

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }

  const existing = await queryRow<RowDataPacket>(
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

  const result = await execute<ResultSetHeader>(
    `INSERT INTO tenant_roles
      (tenant_code, role_code, role_name, role_type, app_code, description,
       source, is_overridden, is_assignable, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, 'custom', 0, ?, ?, NOW(), NOW())`,
    [tenantCode, roleCode, roleName, roleType, description, isAssignable ? 1 : 0, status]
  )

  const role = await loadRole(result.insertId)
  if (!role) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created role'
    })
  }

  return ok({
    id: role.id,
    tenantCode: role.tenant_code,
    roleCode: role.role_code,
    roleName: role.role_name,
    roleType: role.role_type,
    appCode: role.app_code,
    description: role.description,
    isSystem: role.source === 'system' || role.role_type === 'system',
    isAssignable: Boolean(role.is_assignable),
    status: role.status,
    createdAt: role.created_at,
    updatedAt: role.updated_at
  })
})
