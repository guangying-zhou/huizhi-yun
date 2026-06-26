import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import {
  requireAllowedValue,
  SYSTEM_ROLE_STATUSES
} from '~~/server/utils/systemRoleGovernance'

interface SystemRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  description: string | null
  is_required: number
  status: string
}

function requireCode(event: H3Event) {
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'code is required'
    })
  }
  return code
}

export default defineEventHandler(async (event) => {
  const code = requireCode(event)
  const body = await readBody<Record<string, unknown>>(event)

  const current = await queryRow<SystemRoleRow>(
    `SELECT id, role_code, role_name, role_type, app_code, description, is_required, status
     FROM platform_app_roles
     WHERE role_code = ?
     LIMIT 1`,
    [code]
  )

  if (!current) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `system role not found: roleCode=${code}`
    })
  }

  const appCodeInput = body.appCode === undefined
    ? current.app_code
    : normalizeNullableString(body.appCode)
  const appCode = appCodeInput?.trim() || ''

  if (!appCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'appCode is required'
    })
  }

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

  const roleName = body.roleName === undefined
    ? current.role_name
    : String(body.roleName || '').trim()
  if (!roleName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'roleName is required'
    })
  }

  const roleType = 'app'
  const description = body.description === undefined
    ? current.description
    : normalizeNullableString(body.description)
  const isRequired = body.isRequired === undefined
    ? Boolean(current.is_required)
    : Boolean(body.isRequired)
  const status = body.status === undefined
    ? current.status
    : requireAllowedValue(normalizeNullableString(body.status) || 'active', 'status', SYSTEM_ROLE_STATUSES)

  const updated = await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `UPDATE platform_app_roles
       SET role_name = ?,
           role_type = ?,
           app_code = ?,
           description = ?,
           is_required = ?,
           status = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        roleName,
        roleType,
        appCode,
        description,
        isRequired ? 1 : 0,
        status,
        current.id
      ]
    )

    return tx.queryRow<SystemRoleRow>(
      `SELECT id, role_code, role_name, role_type, app_code, description, is_required, status
       FROM platform_app_roles
       WHERE id = ?
       LIMIT 1`,
      [current.id]
    )
  })

  return ok({
    id: updated?.id || current.id,
    roleCode: updated?.role_code || current.role_code,
    roleName: updated?.role_name || roleName,
    roleType: updated?.role_type || roleType,
    appCode: updated?.app_code ?? appCode,
    description: updated?.description ?? description,
    isRequired: Boolean(updated?.is_required ?? isRequired),
    status: updated?.status || status
  })
})
