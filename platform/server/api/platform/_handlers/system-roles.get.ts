import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

type RoleScope = 'platform' | 'tenant' | 'app'

interface SystemRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  description: string | null
  is_required: number
  status: string
  permission_count: number
  template_count: number
  tenant_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

const TENANT_ROLE_TYPES = new Set(['system', 'base', 'tenant'])

function resolveScope(roleType: string, appCode: string | null): RoleScope {
  const normalizedRoleType = String(roleType || '').trim().toLowerCase()
  if (!appCode || normalizedRoleType === 'platform') {
    return 'platform'
  }

  if (TENANT_ROLE_TYPES.has(normalizedRoleType)) {
    return 'tenant'
  }

  return 'app'
}

function normalizeScope(value: string | null): RoleScope | null {
  if (!value) {
    return null
  }

  if (value === 'platform' || value === 'tenant' || value === 'app') {
    return value
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'scope must be one of: platform, tenant, app'
  })
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const scope = normalizeScope(normalizeNullableString(query.scope))
  const appCode = normalizeNullableString(query.appCode)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['psr.app_code <> \'collab\'']
  const params: Array<string | number> = []

  if (scope === 'platform') {
    where.push('(psr.app_code IS NULL OR LOWER(psr.role_type) = \'platform\')')
  } else if (scope === 'tenant') {
    where.push('psr.app_code IS NOT NULL AND LOWER(psr.role_type) IN (\'system\', \'base\', \'tenant\')')
  } else if (scope === 'app') {
    where.push('psr.app_code IS NOT NULL AND LOWER(psr.role_type) NOT IN (\'system\', \'base\', \'tenant\')')
  }

  if (appCode) {
    where.push('psr.app_code = ?')
    params.push(appCode)
  }

  if (status) {
    where.push('psr.status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(psr.role_code LIKE ? OR psr.role_name LIKE ? OR COALESCE(psr.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<SystemRoleRow[]>(
    `SELECT psr.id,
            psr.role_code,
            psr.role_name,
            psr.role_type,
            psr.app_code,
            psr.description,
            psr.is_required,
            psr.status,
            (
              SELECT COUNT(*)
              FROM platform_app_role_permissions psrp
              WHERE psrp.app_role_id = psr.id
            ) AS permission_count,
            (
              SELECT COUNT(*)
              FROM platform_system_app_role_maps sarm
              WHERE sarm.app_role_code = psr.role_code
            ) AS template_count,
            (
              SELECT COUNT(DISTINCT tr.tenant_code)
              FROM tenant_role_app_role_maps tram
              INNER JOIN tenant_roles tr
                ON tr.id = tram.role_id
               AND tr.tenant_code = tram.tenant_code
              WHERE tram.app_role_code = psr.role_code
            ) AS tenant_count
     FROM platform_app_roles psr
     ${whereSql}
     ORDER BY psr.role_type ASC, psr.role_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM platform_app_roles psr
     ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      roleCode: row.role_code,
      roleName: row.role_name,
      roleType: row.role_type,
      appCode: row.app_code,
      scope: resolveScope(row.role_type, row.app_code),
      description: row.description,
      isRequired: Boolean(row.is_required),
      status: row.status,
      permissionCount: row.permission_count,
      templateCount: row.template_count,
      tenantCount: row.tenant_count
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
