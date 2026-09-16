import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { execute, queryRow, queryRows } from '~~/server/utils/db'
import {
  refreshMissingRolePolicySnapshots,
  resolveRolePolicyStatus,
  type RolePolicyStatus
} from '~~/server/utils/rolePolicyHash'

interface SystemRoleRow extends RowDataPacket {
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
  permission_count: number
  scope_count: number
  tenant_role_id: number | null
  tenant_role_status: string | null
  tenant_role_source: string | null
  tenant_role_is_overridden: number | null
  tenant_role_source_policy_hash: string | null
  tenant_role_effective_policy_hash: string | null
  tenant_role_policy_revision: number | null
  tenant_role_policy_updated_at: string | null
  app_codes: string | null
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const appCode = normalizeNullableString(query.appCode)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status) || 'active'
  const enabled = normalizeNullableString(query.enabled)
  const { page, pageSize, offset } = parsePagination(query)

  await refreshMissingRolePolicySnapshots({ queryRow, queryRows, execute }, {
    tenantCode
  })

  const where: string[] = ['psr.status = ?']
  const params: Array<string | number> = [status]

  if (keyword) {
    where.push('(psr.role_code LIKE ? OR psr.role_name LIKE ? OR COALESCE(psr.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  if (appCode) {
    where.push(`EXISTS (
      SELECT 1
      FROM platform_system_app_role_maps sarm_filter
      INNER JOIN platform_app_roles ar_filter
        ON ar_filter.id = sarm_filter.app_role_id
       AND ar_filter.status = 'active'
      WHERE sarm_filter.system_role_id = psr.id
        AND ar_filter.app_code = ?
    )`)
    params.push(appCode)
  }

  if (enabled === 'true') {
    where.push('tr.id IS NOT NULL')
  } else if (enabled === 'false') {
    where.push('tr.id IS NULL')
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const joinSql = `LEFT JOIN tenant_roles tr
       ON tr.tenant_code = ?
      AND tr.source = 'system'
      AND tr.source_role_code = psr.role_code`

  const rows = await queryRows<SystemRoleRow[]>(
    `SELECT psr.id,
            psr.role_code,
            psr.role_name,
            psr.role_type,
            psr.description,
            psr.is_required,
            psr.sort_order,
            psr.status,
            psr.policy_revision,
            psr.policy_hash,
            psr.policy_updated_at,
            (
              SELECT COUNT(*)
              FROM platform_system_app_role_maps sarm
              INNER JOIN platform_app_roles ar_perm
                ON ar_perm.id = sarm.app_role_id
               AND ar_perm.status = 'active'
              INNER JOIN platform_app_role_permissions arp
                ON arp.app_role_id = ar_perm.id
              WHERE sarm.system_role_id = psr.id
            ) AS permission_count,
            (
              SELECT COUNT(*)
              FROM platform_system_app_role_maps sarm
              INNER JOIN platform_app_role_scopes ars
                ON ars.app_role_id = sarm.app_role_id
               AND ars.status = 'active'
              WHERE sarm.system_role_id = psr.id
            ) AS scope_count,
            tr.id AS tenant_role_id,
            tr.status AS tenant_role_status,
            tr.source AS tenant_role_source,
            tr.is_overridden AS tenant_role_is_overridden,
            tr.source_policy_hash AS tenant_role_source_policy_hash,
            tr.effective_policy_hash AS tenant_role_effective_policy_hash,
            tr.policy_revision AS tenant_role_policy_revision,
            tr.policy_updated_at AS tenant_role_policy_updated_at,
            (
              SELECT GROUP_CONCAT(DISTINCT ar_codes.app_code ORDER BY ar_codes.app_code SEPARATOR ',')
              FROM platform_system_app_role_maps sarm_codes
              INNER JOIN platform_app_roles ar_codes
                ON ar_codes.id = sarm_codes.app_role_id
               AND ar_codes.status = 'active'
              WHERE sarm_codes.system_role_id = psr.id
            ) AS app_codes
     FROM platform_system_roles psr
     ${joinSql}
     ${whereSql}
     ORDER BY psr.sort_order ASC, psr.role_code ASC
     LIMIT ? OFFSET ?`,
    [tenantCode, ...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM platform_system_roles psr
     ${joinSql}
     ${whereSql}`,
    [tenantCode, ...params]
  )

  return ok({
    items: rows.map((row) => {
      const enabled = Boolean(row.tenant_role_id)
      const policyStatus: RolePolicyStatus = resolveRolePolicyStatus({
        enabled,
        systemPolicyHash: row.policy_hash,
        tenantSourcePolicyHash: row.tenant_role_source_policy_hash,
        tenantEffectivePolicyHash: row.tenant_role_effective_policy_hash,
        tenantIsOverridden: Boolean(row.tenant_role_is_overridden)
      })

      return {
        id: row.id,
        roleCode: row.role_code,
        roleName: row.role_name,
        roleType: row.role_type,
        appCode: null,
        description: row.description,
        isRequired: Boolean(row.is_required),
        status: row.status,
        policyRevision: Number(row.policy_revision || 0),
        policyHash: row.policy_hash,
        policyUpdatedAt: row.policy_updated_at,
        permissionCount: row.permission_count,
        scopeCount: row.scope_count,
        enabled,
        tenantRoleId: row.tenant_role_id,
        tenantRoleStatus: row.tenant_role_status,
        tenantRoleSource: row.tenant_role_source,
        isOverridden: Boolean(row.tenant_role_is_overridden),
        tenantSourcePolicyHash: row.tenant_role_source_policy_hash,
        tenantEffectivePolicyHash: row.tenant_role_effective_policy_hash,
        tenantPolicyRevision: row.tenant_role_policy_revision == null ? null : Number(row.tenant_role_policy_revision),
        tenantPolicyUpdatedAt: row.tenant_role_policy_updated_at,
        appCodes: row.app_codes ? row.app_codes.split(',').filter(Boolean) : [],
        policyStatus
      }
    }),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
