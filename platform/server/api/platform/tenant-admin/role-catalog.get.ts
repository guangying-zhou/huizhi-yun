import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface RoleCatalogRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  description: string | null
  source: string
  source_role_code: string | null
  status: string
  is_assignable: number
  permission_count: number
  app_role_count: number
  assigned_user_count: number
  app_codes: string | null
}

interface CountRow extends RowDataPacket {
  total: number
}

function categoryForRole(row: Pick<RoleCatalogRow, 'role_code' | 'role_name' | 'description' | 'source'>) {
  const text = `${row.role_code} ${row.role_name} ${row.description || ''}`.toLowerCase()
  if (/(admin|owner|security|deploy|release|root|高权限|安全|发布|管理员)/.test(text)) return 'high_risk_privilege'
  if (/(approve|approval|confirm|audit|review|审批|确认|复核|审计)/.test(text)) return 'approval_duty'
  if (/(manager|leader|lead|head|director|负责人|主管|经理|总监)/.test(text)) return 'management_duty'
  if (row.source === 'custom') return 'custom_role'
  return 'main_position'
}

function categoryLabel(category: string) {
  if (category === 'main_position') return '主岗位'
  if (category === 'management_duty') return '管理职责'
  if (category === 'approval_duty') return '审批职责'
  if (category === 'professional_duty') return '专业职责'
  if (category === 'high_risk_privilege') return '高风险特权'
  return '自定义角色'
}

function categorySort(category: string) {
  return ['main_position', 'management_duty', 'approval_duty', 'professional_duty', 'high_risk_privilege', 'custom_role'].indexOf(category)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const keyword = normalizeNullableString(query.keyword)
  const category = normalizeNullableString(query.category)
  const includeDisabled = normalizeNullableString(query.includeDisabled) === 'true'
  const { page, pageSize, offset } = parsePagination(query)
  const where = ['tr.tenant_code = ?', 'tr.app_code IS NULL', 'tr.is_assignable = 1']
  const params: Array<string | number> = [tenantCode]

  if (!includeDisabled) {
    where.push('tr.status = \'active\'')
  }
  if (keyword) {
    where.push('(tr.role_code LIKE ? OR tr.role_name LIKE ? OR COALESCE(tr.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const rows = await queryRows<RoleCatalogRow[]>(
    `SELECT tr.id,
            tr.role_code,
            tr.role_name,
            tr.role_type,
            tr.description,
            tr.source,
            tr.source_role_code,
            tr.status,
            tr.is_assignable,
            (
              SELECT COUNT(*)
              FROM tenant_role_permissions trp
              WHERE trp.tenant_code = tr.tenant_code
                AND trp.role_id = tr.id
            ) + (
              SELECT COUNT(*)
              FROM tenant_role_app_role_maps tram_perm
              INNER JOIN platform_app_roles ar_perm
                ON ar_perm.role_code = tram_perm.app_role_code
               AND ar_perm.status = 'active'
              INNER JOIN platform_app_role_permissions arp
                ON arp.app_role_id = ar_perm.id
              WHERE tram_perm.tenant_code = tr.tenant_code
                AND tram_perm.role_id = tr.id
            ) AS permission_count,
            (
              SELECT COUNT(*)
              FROM tenant_role_app_role_maps tram_count
              WHERE tram_count.tenant_code = tr.tenant_code
                AND tram_count.role_id = tr.id
            ) AS app_role_count,
            (
              SELECT COUNT(DISTINCT ts.subject_code)
              FROM tenant_subject_roles tsr
              INNER JOIN tenant_subjects ts
                ON ts.id = tsr.subject_id
               AND ts.tenant_code = tsr.tenant_code
               AND ts.subject_type = 'user'
               AND ts.status = 'active'
              WHERE tsr.tenant_code = tr.tenant_code
                AND tsr.role_id = tr.id
                AND tsr.status = 'active'
                AND (tsr.starts_at IS NULL OR tsr.starts_at <= UTC_TIMESTAMP())
                AND (tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())
            ) AS assigned_user_count,
            (
              SELECT GROUP_CONCAT(DISTINCT ar.app_code ORDER BY ar.app_code SEPARATOR ',')
              FROM tenant_role_app_role_maps tram
              INNER JOIN platform_app_roles ar
                ON ar.role_code = tram.app_role_code
               AND ar.status = 'active'
              WHERE tram.tenant_code = tr.tenant_code
                AND tram.role_id = tr.id
            ) AS app_codes
     FROM tenant_roles tr
     ${whereSql}
     ORDER BY tr.source ASC, tr.role_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const categorized = rows
    .map((row) => {
      const derivedCategory = categoryForRole(row)
      return {
        id: row.id,
        tenantCode,
        roleCode: row.role_code,
        roleName: row.role_name,
        roleType: row.role_type,
        description: row.description,
        source: row.source,
        sourceRoleCode: row.source_role_code,
        status: row.status,
        isAssignable: Boolean(row.is_assignable),
        category: derivedCategory,
        categoryLabel: categoryLabel(derivedCategory),
        permissionCount: Number(row.permission_count || 0),
        appRoleCount: Number(row.app_role_count || 0),
        assignedUserCount: Number(row.assigned_user_count || 0),
        appCodes: row.app_codes ? row.app_codes.split(',').filter(Boolean) : []
      }
    })
    .filter(row => !category || row.category === category)
    .sort((left, right) => categorySort(left.category) - categorySort(right.category) || left.roleCode.localeCompare(right.roleCode))

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM tenant_roles tr
     ${whereSql}`,
    params
  )

  return ok({
    items: categorized,
    total: category ? categorized.length : (totalRow?.total || 0),
    page,
    pageSize,
    categories: ['main_position', 'management_duty', 'approval_duty', 'professional_duty', 'high_risk_privilege', 'custom_role'].map(item => ({
      value: item,
      label: categoryLabel(item),
      count: categorized.filter(role => role.category === item).length
    }))
  })
})
