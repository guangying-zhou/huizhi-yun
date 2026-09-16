import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface TenantRoleRow extends RowDataPacket {
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

interface PlatformRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  description: string | null
  is_builtin: number
  is_assignable: number
  status: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = normalizeNullableString(query.tenantCode)
  const roleType = normalizeNullableString(query.roleType)
  const appCode = normalizeNullableString(query.appCode)
  const status = normalizeNullableString(query.status)
  const keyword = normalizeNullableString(query.keyword)
  const { page, pageSize, offset } = parsePagination(query)

  if (tenantCode) {
    const where: string[] = ['tenant_code = ?']
    const params: Array<string | number> = [tenantCode]

    if (roleType) {
      where.push('role_type = ?')
      params.push(roleType)
    }

    if (appCode) {
      where.push('(app_code = ? OR app_code IS NULL)')
      params.push(appCode)
    }

    if (status) {
      where.push('status = ?')
      params.push(status)
    }

    if (keyword) {
      where.push('(role_code LIKE ? OR role_name LIKE ? OR COALESCE(description, \'\') LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }

    const whereSql = `WHERE ${where.join(' AND ')}`

    const items = await queryRows<TenantRoleRow[]>(
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
  }

  const where: string[] = ['1 = 1']
  const params: Array<string | number> = []

  if (status) {
    where.push('status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(role_code LIKE ? OR role_name LIKE ? OR COALESCE(description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const items = await queryRows<PlatformRoleRow[]>(
    `SELECT id, role_code, role_name, description, is_builtin, is_assignable, status
     FROM platform_roles
     ${whereSql}
     ORDER BY role_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM platform_roles
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: null,
      roleCode: item.role_code,
      roleName: item.role_name,
      roleType: 'platform',
      appCode: null,
      description: item.description,
      isSystem: Boolean(item.is_builtin),
      isAssignable: Boolean(item.is_assignable),
      status: item.status
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
