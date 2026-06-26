import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
  role_name: string
}

interface AppRoleMapRow extends RowDataPacket {
  app_role_code: string
  app_code: string
  role_name: string
  source_system_role_code: string | null
  sort_order: number
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

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const tenantCode = requireString(getQuery(event).tenantCode, 'tenantCode')

  const role = await queryRow<RoleRow>(
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

  const items = await queryRows<AppRoleMapRow[]>(
    `SELECT tram.app_role_code,
            ar.app_code,
            ar.role_name,
            tram.source_system_role_code,
            tram.sort_order
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
     WHERE tram.tenant_code = ?
       AND tram.role_id = ?
       AND ar.status = 'active'
       AND ar.app_code <> 'collab'
     ORDER BY tram.sort_order ASC, tram.app_role_code ASC`,
    [tenantCode, id]
  )

  return ok({
    role: {
      id: role.id,
      tenantCode: role.tenant_code,
      roleCode: role.role_code,
      roleName: role.role_name
    },
    items: items.map(item => ({
      appRoleCode: item.app_role_code,
      appCode: item.app_code,
      appRoleName: item.role_name,
      sourceSystemRoleCode: item.source_system_role_code,
      sortOrder: Number(item.sort_order || 0)
    }))
  })
})
