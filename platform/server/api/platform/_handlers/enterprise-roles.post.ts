import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { refreshEnterpriseSystemRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'

const ROLE_STATUSES = new Set(['active', 'suspended', 'disabled'])

interface RoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  description: string | null
  is_required: number
  sort_order: number
  status: string
}

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

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const roleCode = requireString(body.roleCode, 'roleCode').trim()
  const roleName = requireString(body.roleName, 'roleName').trim()
  const roleType = normalizeNullableString(body.roleType) || 'system'
  const description = normalizeNullableString(body.description)
  const isRequired = body.isRequired === undefined ? false : Boolean(body.isRequired)
  const sortOrder = Number(body.sortOrder || 0)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ROLE_STATUSES)

  if (!Number.isInteger(sortOrder)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'sortOrder must be an integer'
    })
  }

  const result = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM platform_system_roles
       WHERE role_code = ?
       LIMIT 1`,
      [roleCode]
    )

    if (existing) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `enterprise role already exists: roleCode=${roleCode}`
      })
    }

    const insertResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_system_roles
        (role_code, role_name, role_type, description, is_required, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [roleCode, roleName, roleType, description, isRequired ? 1 : 0, sortOrder, status]
    )

    await refreshEnterpriseSystemRolePolicySnapshot(tx, insertResult.insertId)

    const role = await tx.queryRow<RoleRow>(
      `SELECT id, role_code, role_name, role_type, description, is_required, sort_order, status
       FROM platform_system_roles
       WHERE id = ?
       LIMIT 1`,
      [insertResult.insertId]
    )

    return role
  })

  if (!result) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created enterprise role'
    })
  }

  return ok({
    id: result.id,
    roleCode: result.role_code,
    roleName: result.role_name,
    roleType: result.role_type,
    description: result.description,
    isRequired: Boolean(result.is_required),
    sortOrder: Number(result.sort_order || 0),
    status: result.status
  })
})
