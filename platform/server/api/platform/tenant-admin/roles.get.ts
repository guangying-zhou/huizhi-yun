import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

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
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const roleType = normalizeNullableString(query.roleType)
  const status = normalizeNullableString(query.status)
  const keyword = normalizeNullableString(query.keyword)
  const appCode = normalizeNullableString(query.appCode)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['tenant_code = ?']
  const params: Array<string | number> = [tenantCode]

  if (roleType) {
    where.push('role_type = ?')
    params.push(roleType)
  }

  if (status) {
    where.push('status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(role_code LIKE ? OR role_name LIKE ? OR COALESCE(description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  if (appCode) {
    where.push(`EXISTS (
      SELECT 1
      FROM tenant_role_app_role_maps tram
      INNER JOIN platform_app_roles ar
        ON ar.role_code = tram.app_role_code
      WHERE tram.tenant_code = tenant_roles.tenant_code
        AND tram.role_id = tenant_roles.id
        AND ar.app_code = ?
    )`)
    params.push(appCode)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const items = await queryRows<RoleRow[]>(
    `SELECT id, tenant_code, role_code, role_name, role_type, app_code, description, source, is_assignable, status
     FROM tenant_roles
     ${whereSql}
     ORDER BY role_type ASC, role_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM tenant_roles
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: item.tenant_code,
      roleCode: item.role_code,
      roleName: item.role_name,
      roleType: item.role_type,
      appCode: item.app_code,
      description: item.description,
      isSystem: item.source === 'system' || item.role_type === 'system',
      isAssignable: Boolean(item.is_assignable),
      status: item.status
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
