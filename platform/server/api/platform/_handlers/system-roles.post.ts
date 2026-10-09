import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import {
  requireAllowedValue,
  replaceSystemRolePermissions,
  SYSTEM_ROLE_STATUSES
} from '~~/server/utils/systemRoleGovernance'

interface CreatedRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  description: string | null
  is_required: number
  status: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const roleCode = requireString(body.roleCode, 'roleCode').trim()
  const roleName = requireString(body.roleName, 'roleName').trim()
  const appCode = requireString(body.appCode, 'appCode').trim()
  const description = normalizeNullableString(body.description)
  const isRequired = body.isRequired === undefined ? false : Boolean(body.isRequired)
  const status = requireAllowedValue(normalizeNullableString(body.status) || 'active', 'status', SYSTEM_ROLE_STATUSES)
  const permissions = Array.isArray(body.permissions) ? body.permissions : []

  if (!appCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'appCode is required'
    })
  }

  const roleType = 'app'

  const app = await queryRow<RowDataPacket>(
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

  const result = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM platform_app_roles
       WHERE role_code = ?
       LIMIT 1`,
      [roleCode]
    )

    if (existing) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `system role already exists: roleCode=${roleCode}`
      })
    }

    const insertResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_app_roles
        (role_code, role_name, role_type, app_code, description, is_required, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [roleCode, roleName, roleType, appCode, description, isRequired ? 1 : 0, status]
    )

    const roleId = insertResult.insertId
    const resolvedPermissions = await replaceSystemRolePermissions(tx, roleId, permissions as Record<string, unknown>[])

    const createdRole = await tx.queryRow<CreatedRoleRow>(
      `SELECT id, role_code, role_name, role_type, app_code, description, is_required, status
       FROM platform_app_roles
       WHERE id = ?
       LIMIT 1`,
      [roleId]
    )

    return { createdRole, resolvedPermissions }
  })

  if (!result.createdRole) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created system role'
    })
  }

  return ok({
    id: result.createdRole.id,
    roleCode: result.createdRole.role_code,
    roleName: result.createdRole.role_name,
    roleType: result.createdRole.role_type,
    appCode: result.createdRole.app_code,
    description: result.createdRole.description,
    isRequired: Boolean(result.createdRole.is_required),
    status: result.createdRole.status,
    permissionCount: result.resolvedPermissions.length,
    permissions: result.resolvedPermissions
  })
})
