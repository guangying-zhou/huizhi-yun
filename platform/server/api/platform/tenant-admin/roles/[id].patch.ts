import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok } from '~~/server/utils/api'
import { TENANT_CONSOLE_APP_CODE } from '~~/server/utils/tenantConsole'

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  description: string | null
  source: string
  is_overridden: number
  is_assignable: number
  status: string
  created_at: string
  updated_at: string
}

const ALLOWED_ROLE_TYPES = new Set(['system', 'custom'])
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
            source, is_overridden, is_assignable, status, created_at, updated_at
     FROM tenant_roles
     WHERE id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)

  const existing = await loadRole(id)
  if (!existing || existing.app_code !== TENANT_CONSOLE_APP_CODE) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant console role not found: id=${id}`
    })
  }

  const updates: string[] = []
  const params: Array<string | number | null> = []

  if (body.roleName !== undefined) {
    const roleName = String(body.roleName || '').trim()
    if (!roleName) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'roleName is required'
      })
    }
    updates.push('role_name = ?')
    params.push(roleName)
  }

  if (body.roleType !== undefined) {
    updates.push('role_type = ?')
    params.push(requireAllowed(String(body.roleType), 'roleType', ALLOWED_ROLE_TYPES))
  }

  if (body.description !== undefined) {
    updates.push('description = ?')
    params.push(normalizeNullableString(body.description))
  }

  if (body.isAssignable !== undefined) {
    updates.push('is_assignable = ?')
    params.push(body.isAssignable ? 1 : 0)
  }

  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(requireAllowed(String(body.status), 'status', ALLOWED_STATUSES))
  }

  if (updates.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'no updatable fields provided'
    })
  }

  updates.push('app_code = ?')
  params.push(TENANT_CONSOLE_APP_CODE)
  if (existing.source === 'system') {
    updates.push('is_overridden = 1')
  }

  await execute<ResultSetHeader>(
    `UPDATE tenant_roles
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = ?`,
    [...params, id]
  )

  const role = await loadRole(id)
  if (!role) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load updated role'
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
