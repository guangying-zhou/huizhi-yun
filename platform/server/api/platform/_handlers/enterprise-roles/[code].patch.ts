import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'

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

function requireCode(event: Parameters<typeof getRouterParam>[0]) {
  const code = getRouterParam(event, 'code')
  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'code is required'
    })
  }

  return decodeURIComponent(code)
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
  const code = requireCode(event)
  const body = await readBody<Record<string, unknown>>(event)

  const sets: string[] = []
  const params: Array<string | number | null> = []

  if (body.roleName !== undefined) {
    const roleName = normalizeNullableString(body.roleName)
    if (!roleName) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'roleName is required'
      })
    }
    sets.push('role_name = ?')
    params.push(roleName.trim())
  }

  if (body.roleType !== undefined) {
    const roleType = normalizeNullableString(body.roleType)
    if (!roleType) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'roleType is required'
      })
    }
    sets.push('role_type = ?')
    params.push(roleType.trim())
  }

  if (body.description !== undefined) {
    sets.push('description = ?')
    params.push(normalizeNullableString(body.description))
  }

  if (body.isRequired !== undefined) {
    sets.push('is_required = ?')
    params.push(body.isRequired ? 1 : 0)
  }

  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder || 0)
    if (!Number.isInteger(sortOrder)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'sortOrder must be an integer'
      })
    }
    sets.push('sort_order = ?')
    params.push(sortOrder)
  }

  if (body.status !== undefined) {
    sets.push('status = ?')
    params.push(requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ROLE_STATUSES))
  }

  if (sets.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'no fields to update'
    })
  }

  const result = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RoleRow>(
      `SELECT id
       FROM platform_system_roles
       WHERE role_code = ?
       LIMIT 1`,
      [code]
    )

    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `enterprise role not found: roleCode=${code}`
      })
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_system_roles
       SET ${sets.join(', ')},
           updated_at = UTC_TIMESTAMP()
       WHERE role_code = ?`,
      [...params, code]
    )

    return await tx.queryRow<RoleRow>(
      `SELECT id, role_code, role_name, role_type, description, is_required, sort_order, status
       FROM platform_system_roles
       WHERE role_code = ?
       LIMIT 1`,
      [code]
    )
  })

  return ok({
    id: result?.id,
    roleCode: result?.role_code,
    roleName: result?.role_name,
    roleType: result?.role_type,
    description: result?.description,
    isRequired: Boolean(result?.is_required),
    sortOrder: Number(result?.sort_order || 0),
    status: result?.status
  })
})
