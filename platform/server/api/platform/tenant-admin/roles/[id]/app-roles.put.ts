import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { refreshTenantRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
  role_name: string
}

interface AppRoleRow extends RowDataPacket {
  id: number
  role_code: string
  app_code: string
}

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

function normalizeAppRoleCode(value: unknown, index: number) {
  const code = String(
    typeof value === 'string'
      ? value
      : (value && typeof value === 'object' ? (value as Record<string, unknown>).appRoleCode : '')
  ).trim()

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `appRoles[${index}].appRoleCode is required`
    })
  }

  return code
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const tenantCode = requireString(getQuery(event).tenantCode, 'tenantCode')
  const body = await readBody<Record<string, unknown>>(event)
  const rawItems = Array.isArray(body.appRoles) ? body.appRoles : []
  const appRoleCodes = rawItems.map(normalizeAppRoleCode)
  const uniqueCodes = [...new Set(appRoleCodes)]

  if (uniqueCodes.length !== appRoleCodes.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'duplicate app role codes'
    })
  }

  const result = await withTransaction(async (tx) => {
    const role = await tx.queryRow<RoleRow>(
      `SELECT id, tenant_code, role_code, role_name
       FROM tenant_roles
       WHERE id = ?
         AND tenant_code = ?
       LIMIT 1`,
      [id, tenantCode]
    )

    if (!role) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `tenant role not found: id=${id}`
      })
    }

    const resolved: AppRoleRow[] = []
    for (const code of uniqueCodes) {
      const appRole = await tx.queryRow<AppRoleRow>(
        `SELECT id, role_code, app_code
         FROM platform_app_roles
         WHERE role_code = ?
           AND status = 'active'
           AND app_code <> 'collab'
         LIMIT 1`,
        [code]
      )

      if (!appRole) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `active app role not found: appRoleCode=${code}`
        })
      }

      resolved.push(appRole)
    }

    await tx.execute<ResultSetHeader>(
      `DELETE FROM tenant_role_app_role_maps
       WHERE tenant_code = ?
         AND role_id = ?`,
      [tenantCode, id]
    )

    for (const [index, appRole] of resolved.entries()) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_role_app_role_maps
          (tenant_code, role_id, app_role_code, source_system_role_code, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [tenantCode, id, appRole.role_code, index]
      )
    }

    await refreshTenantRolePolicySnapshot(tx, tenantCode, id, {
      isOverridden: true
    })

    return {
      role,
      appRoles: resolved
    }
  })

  return ok({
    role: {
      id: result.role.id,
      tenantCode: result.role.tenant_code,
      roleCode: result.role.role_code,
      roleName: result.role.role_name
    },
    appRoles: result.appRoles.map(item => ({
      appRoleCode: item.role_code,
      appCode: item.app_code
    }))
  })
})
