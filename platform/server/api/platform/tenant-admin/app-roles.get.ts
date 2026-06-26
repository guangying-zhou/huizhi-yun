import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface AppRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string
  description: string | null
  status: string
  permission_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appCode = normalizeNullableString(query.appCode)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status) || 'active'
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['ar.status = ?', 'ar.app_code <> \'collab\'']
  const params: Array<string | number> = [status]

  if (appCode) {
    where.push('ar.app_code = ?')
    params.push(appCode)
  }

  if (keyword) {
    where.push('(ar.role_code LIKE ? OR ar.role_name LIKE ? OR COALESCE(ar.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<AppRoleRow[]>(
    `SELECT ar.id,
            ar.role_code,
            ar.role_name,
            ar.role_type,
            ar.app_code,
            ar.description,
            ar.status,
            (
              SELECT COUNT(*)
              FROM platform_app_role_permissions arp
              WHERE arp.app_role_id = ar.id
            ) AS permission_count
     FROM platform_app_roles ar
     ${whereSql}
     ORDER BY ar.app_code ASC, ar.role_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM platform_app_roles ar
     ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(item => ({
      id: item.id,
      roleCode: item.role_code,
      roleName: item.role_name,
      roleType: item.role_type,
      appCode: item.app_code,
      description: item.description,
      status: item.status,
      permissionCount: Number(item.permission_count || 0)
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
