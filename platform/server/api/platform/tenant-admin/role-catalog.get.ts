import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'
import {
  deriveRoleCatalogCategory,
  generateRoleCatalogSplitSuggestion,
  isRoleCatalogMetadataMissingTableError,
  ROLE_CATALOG_CATEGORIES,
  roleCatalogCategorySort
} from '~~/server/utils/roleCatalogCategory'

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
  catalog_category: string | null
  governance_note: string | null
  split_suggestion: string | null
  catalog_updated_by_uid: string | null
  catalog_updated_at: string | null
}

async function loadRoleCatalogRows(whereSql: string, params: Array<string | number>, includeMetadata: boolean) {
  const metadataColumns = includeMetadata
    ? `trcm.category AS catalog_category,
       trcm.governance_note,
       trcm.split_suggestion,
       trcm.updated_by_uid AS catalog_updated_by_uid,
       trcm.updated_at AS catalog_updated_at`
    : `NULL AS catalog_category,
       NULL AS governance_note,
       NULL AS split_suggestion,
       NULL AS catalog_updated_by_uid,
       NULL AS catalog_updated_at`
  const metadataJoin = includeMetadata
    ? `LEFT JOIN tenant_role_catalog_metadata trcm
         ON trcm.tenant_code = tr.tenant_code
        AND trcm.role_id = tr.id`
    : ''

  return await queryRows<RoleCatalogRow[]>(
    `SELECT tr.id,
            tr.role_code,
            tr.role_name,
            tr.role_type,
            tr.description,
            tr.source,
            tr.source_role_code,
            tr.status,
            tr.is_assignable,
            ${metadataColumns},
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
     ${metadataJoin}
     ${whereSql}
     ORDER BY tr.source ASC, tr.role_code ASC`,
    params
  )
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
  let metadataAvailable = true
  let rows: RoleCatalogRow[]
  try {
    rows = await loadRoleCatalogRows(whereSql, params, true)
  } catch (error) {
    if (!isRoleCatalogMetadataMissingTableError(error)) throw error
    metadataAvailable = false
    rows = await loadRoleCatalogRows(whereSql, params, false)
  }

  const allCategorized = rows
    .map((row) => {
      const derivedCategory = deriveRoleCatalogCategory({
        roleCode: row.role_code,
        roleName: row.role_name,
        description: row.description,
        source: row.source,
        catalogCategory: row.catalog_category
      })
      const appCodes = row.app_codes ? row.app_codes.split(',').filter(Boolean) : []
      const permissionCount = Number(row.permission_count || 0)
      const appRoleCount = Number(row.app_role_count || 0)
      const assignedUserCount = Number(row.assigned_user_count || 0)
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
        category: derivedCategory.category,
        categoryLabel: derivedCategory.label,
        categorySource: derivedCategory.source,
        governanceNote: row.governance_note,
        splitSuggestion: row.split_suggestion,
        generatedSplitSuggestion: generateRoleCatalogSplitSuggestion({
          roleCode: row.role_code,
          roleName: row.role_name,
          description: row.description,
          source: row.source,
          category: derivedCategory.category,
          permissionCount,
          appRoleCount,
          assignedUserCount,
          appCodes
        }),
        catalogUpdatedByUid: row.catalog_updated_by_uid,
        catalogUpdatedAt: row.catalog_updated_at,
        permissionCount,
        appRoleCount,
        assignedUserCount,
        appCodes
      }
    })
    .sort((left, right) => roleCatalogCategorySort(left.category) - roleCatalogCategorySort(right.category) || left.roleCode.localeCompare(right.roleCode))

  const categorized = allCategorized.filter(row => !category || row.category === category)
  const pagedItems = categorized.slice(offset, offset + pageSize)

  return ok({
    items: pagedItems,
    total: categorized.length,
    page,
    pageSize,
    metadataAvailable,
    categories: ROLE_CATALOG_CATEGORIES.map(item => ({
      value: item.value,
      label: item.label,
      count: allCategorized.filter(role => role.category === item.value).length
    }))
  })
})
