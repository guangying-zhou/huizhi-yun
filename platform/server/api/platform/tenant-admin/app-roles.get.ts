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

interface PermissionRow extends RowDataPacket {
  app_role_id: number
  app_code: string
  resource_code: string
  resource_name: string | null
  action: string
  manifest_action_id: number | null
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

  const roleIds = rows.map(item => item.id)
  const permissions = roleIds.length > 0
    ? await queryRows<PermissionRow[]>(
        `SELECT arp.app_role_id,
                arp.app_code,
                arp.resource_code,
                COALESCE(source_mr.resource_name, latest_mr.resource_name, arp.resource_code) AS resource_name,
                arp.action,
                arp.manifest_action_id
           FROM platform_app_role_permissions arp
           LEFT JOIN platform_app_manifest_resource_actions source_mra
             ON source_mra.id = arp.manifest_action_id
           LEFT JOIN platform_app_manifest_resources source_mr
             ON source_mr.id = source_mra.manifest_resource_id
           LEFT JOIN platform_applications pa
             ON pa.app_code = arp.app_code
           LEFT JOIN platform_app_manifest_resources latest_mr
             ON latest_mr.app_code = arp.app_code
            AND latest_mr.manifest_id = pa.latest_manifest_id
            AND latest_mr.resource_code = arp.resource_code
          WHERE arp.app_role_id IN (${roleIds.map(() => '?').join(',')})
          ORDER BY arp.app_code ASC, arp.resource_code ASC, arp.action ASC`,
        roleIds
      )
    : []
  const permissionsByRoleId = new Map<number, PermissionRow[]>()
  for (const permission of permissions) {
    const list = permissionsByRoleId.get(permission.app_role_id) || []
    list.push(permission)
    permissionsByRoleId.set(permission.app_role_id, list)
  }

  return ok({
    items: rows.map(item => ({
      id: item.id,
      roleCode: item.role_code,
      roleName: item.role_name,
      roleType: item.role_type,
      appCode: item.app_code,
      description: item.description,
      status: item.status,
      permissionCount: Number(item.permission_count || 0),
      permissions: (permissionsByRoleId.get(item.id) || []).map(permission => ({
        appCode: permission.app_code,
        resourceCode: permission.resource_code,
        resourceName: permission.resource_name,
        action: permission.action,
        manifestActionId: permission.manifest_action_id
      }))
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
