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
  source_role_code: string | null
  source_policy_hash: string | null
  effective_policy_hash: string | null
  policy_revision: number
  policy_updated_at: string | null
  is_overridden: number
  is_assignable: number
  status: string
  permission_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const appCode = normalizeNullableString(query.appCode)
  const keyword = normalizeNullableString(query.keyword)
  const includeDisabled = normalizeNullableString(query.includeDisabled) === 'true'
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['tr.tenant_code = ?', 'tr.is_assignable = 1']
  const params: Array<string | number> = [tenantCode]

  if (!includeDisabled) {
    where.push('tr.status = \'active\'')
  }

  if (appCode) {
    where.push(`EXISTS (
      SELECT 1
      FROM tenant_role_app_role_maps tram
      INNER JOIN platform_app_roles ar
        ON ar.role_code = tram.app_role_code
      WHERE tram.tenant_code = tr.tenant_code
        AND tram.role_id = tr.id
        AND ar.app_code = ?
    )`)
    params.push(appCode)
  }

  if (keyword) {
    where.push('(tr.role_code LIKE ? OR tr.role_name LIKE ? OR COALESCE(tr.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<RoleRow[]>(
    `SELECT tr.id,
            tr.tenant_code,
            tr.role_code,
            tr.role_name,
            tr.role_type,
            tr.app_code,
            tr.description,
            tr.source,
            tr.source_role_code,
            tr.source_policy_hash,
            tr.effective_policy_hash,
            tr.policy_revision,
            tr.policy_updated_at,
            tr.is_overridden,
            tr.is_assignable,
            tr.status,
            (
              SELECT COUNT(*)
              FROM tenant_role_permissions trp
              WHERE trp.tenant_code = tr.tenant_code
                AND trp.role_id = tr.id
            ) + (
              SELECT COUNT(*)
              FROM tenant_role_app_role_maps tram
              INNER JOIN platform_app_roles ar
                ON ar.role_code = tram.app_role_code
               AND ar.status = 'active'
              INNER JOIN platform_app_role_permissions arp
                ON arp.app_role_id = ar.id
              WHERE tram.tenant_code = tr.tenant_code
                AND tram.role_id = tr.id
            ) AS permission_count
     FROM tenant_roles tr
     ${whereSql}
     ORDER BY COALESCE(tr.app_code, '') ASC, tr.source ASC, tr.role_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM tenant_roles tr
     ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      tenantCode: row.tenant_code,
      roleCode: row.role_code,
      roleName: row.role_name,
      roleType: row.role_type,
      appCode: row.app_code,
      description: row.description,
      source: row.source,
      sourceRoleCode: row.source_role_code,
      sourcePolicyHash: row.source_policy_hash,
      effectivePolicyHash: row.effective_policy_hash,
      policyRevision: Number(row.policy_revision || 0),
      policyUpdatedAt: row.policy_updated_at,
      isOverridden: Boolean(row.is_overridden),
      isAssignable: Boolean(row.is_assignable),
      status: row.status,
      permissionCount: row.permission_count
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
