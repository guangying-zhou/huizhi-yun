import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { refreshEnterpriseSystemRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'

interface EnterpriseRoleRow extends RowDataPacket {
  id: number
  role_code: string
}

interface AppRoleRow extends RowDataPacket {
  id: number
  role_code: string
  app_code: string
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
  const code = requireCode(event)
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
    const role = await tx.queryRow<EnterpriseRoleRow>(
      `SELECT id, role_code
       FROM platform_system_roles
       WHERE role_code = ?
       LIMIT 1`,
      [code]
    )

    if (!role) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `enterprise role not found: roleCode=${code}`
      })
    }

    const appRoles: AppRoleRow[] = []
    for (const appRoleCode of uniqueCodes) {
      const appRole = await tx.queryRow<AppRoleRow>(
        `SELECT id, role_code, app_code
         FROM platform_app_roles
         WHERE role_code = ?
           AND status = 'active'
           AND app_code <> 'collab'
         LIMIT 1`,
        [appRoleCode]
      )

      if (!appRole) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `active app role not found: appRoleCode=${appRoleCode}`
        })
      }

      appRoles.push(appRole)
    }

    await tx.execute<ResultSetHeader>(
      `DELETE FROM platform_system_app_role_maps
       WHERE system_role_id = ?`,
      [role.id]
    )

    for (const [index, appRole] of appRoles.entries()) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_system_app_role_maps
          (system_role_id, system_role_code, app_role_id, app_role_code, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [role.id, role.role_code, appRole.id, appRole.role_code, index]
      )
    }

    const snapshot = await refreshEnterpriseSystemRolePolicySnapshot(tx, role.id)

    return {
      role,
      appRoles,
      snapshot
    }
  })

  return ok({
    role: {
      id: result.role.id,
      roleCode: result.role.role_code
    },
    appRoles: result.appRoles.map(item => ({
      appRoleCode: item.role_code,
      appCode: item.app_code
    })),
    policyHash: result.snapshot.policyHash,
    policyRevisionChanged: result.snapshot.changed
  })
})
