import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface EnterpriseRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  description: string | null
  is_required: number
  sort_order: number
  status: string
  policy_revision: number
  policy_hash: string | null
  policy_updated_at: string | null
  app_role_count: number
  permission_count: number
  tenant_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const roleType = normalizeNullableString(query.roleType)
  const status = normalizeNullableString(query.status)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['1 = 1']
  const params: Array<string | number> = []

  if (roleType) {
    where.push('sr.role_type = ?')
    params.push(roleType)
  }

  if (status) {
    where.push('sr.status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(sr.role_code LIKE ? OR sr.role_name LIKE ? OR COALESCE(sr.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<EnterpriseRoleRow[]>(
    `SELECT sr.id,
            sr.role_code,
            sr.role_name,
            sr.role_type,
            sr.description,
            sr.is_required,
            sr.sort_order,
            sr.status,
            sr.policy_revision,
            sr.policy_hash,
            sr.policy_updated_at,
            (
              SELECT COUNT(*)
              FROM platform_system_app_role_maps sarm
              WHERE sarm.system_role_id = sr.id
            ) AS app_role_count,
            (
              SELECT COUNT(*)
              FROM platform_system_app_role_maps sarm
              INNER JOIN platform_app_role_permissions arp
                ON arp.app_role_id = sarm.app_role_id
              WHERE sarm.system_role_id = sr.id
            ) AS permission_count,
            (
              SELECT COUNT(DISTINCT tr.tenant_code)
              FROM tenant_roles tr
              WHERE tr.source = 'system'
                AND tr.source_role_code = sr.role_code
            ) AS tenant_count
     FROM platform_system_roles sr
     ${whereSql}
     ORDER BY sr.sort_order ASC, sr.role_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM platform_system_roles sr
     ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      roleCode: row.role_code,
      roleName: row.role_name,
      roleType: row.role_type,
      description: row.description,
      isRequired: Boolean(row.is_required),
      sortOrder: Number(row.sort_order || 0),
      status: row.status,
      policyRevision: Number(row.policy_revision || 0),
      policyHash: row.policy_hash,
      policyUpdatedAt: row.policy_updated_at,
      appRoleCount: Number(row.app_role_count || 0),
      permissionCount: Number(row.permission_count || 0),
      tenantCount: Number(row.tenant_count || 0)
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
