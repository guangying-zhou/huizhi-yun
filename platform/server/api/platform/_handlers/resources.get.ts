import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface ResourceRow extends RowDataPacket {
  id: number
  manifest_id: number
  app_code: string
  resource_code: string
  resource_name: string
  description: string | null
  sort_order: number
  status: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  requireString(query.tenantCode, 'tenantCode')
  const appCode = normalizeNullableString(query.appCode)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status) || 'active'
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['pa.latest_manifest_id IS NOT NULL']
  const params: Array<string | number> = []

  if (appCode) {
    where.push('mr.app_code = ?')
    params.push(appCode)
  }

  if (status) {
    where.push('mr.status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(mr.app_code LIKE ? OR mr.resource_code LIKE ? OR mr.resource_name LIKE ? OR COALESCE(mr.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const items = await queryRows<ResourceRow[]>(
    `SELECT mr.id, mr.manifest_id, mr.app_code, mr.resource_code, mr.resource_name, mr.description, mr.sort_order, mr.status
     FROM platform_app_manifest_resources mr
     INNER JOIN platform_applications pa
       ON pa.app_code = mr.app_code
      AND pa.latest_manifest_id = mr.manifest_id
     ${whereSql}
     ORDER BY mr.app_code ASC, mr.sort_order ASC, mr.resource_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM platform_app_manifest_resources mr
     INNER JOIN platform_applications pa
       ON pa.app_code = mr.app_code
      AND pa.latest_manifest_id = mr.manifest_id
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: null,
      manifestId: item.manifest_id,
      appCode: item.app_code,
      resourceCode: item.resource_code,
      resourceName: item.resource_name,
      description: item.description,
      sortOrder: item.sort_order,
      status: item.status
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
