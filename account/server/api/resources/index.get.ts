import { defineEventHandler, getQuery } from 'h3'
import { queryRows } from '../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface ResourceRow extends RowDataPacket {
  id: number
  app_id: number
  resource_code: string
  resource_name: string
  description: string | null
  sort_order: number
  status: number
  created_at: string
  updated_at: string
  app_code?: string
  app_name?: string
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appId = query.app_id ? Number(query.app_id) : null
  const appCode = query.app_code as string | undefined
  const status = query.status !== undefined ? Number(query.status) : null

  const whereConditions: string[] = []
  const params: unknown[] = []

  if (appId) {
    whereConditions.push('r.app_id = ?')
    params.push(appId)
  }

  if (appCode) {
    whereConditions.push('a.app_code = ?')
    params.push(appCode)
  }

  if (status !== null) {
    whereConditions.push('r.status = ?')
    params.push(status)
  }

  const whereSQL = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

  const sql = `
    SELECT 
      r.id, r.app_id, r.resource_code, r.resource_name, 
      r.description, r.sort_order, r.status, r.created_at, r.updated_at,
      a.app_code, a.app_name
    FROM resources r
    LEFT JOIN applications a ON r.app_id = a.id
    ${whereSQL}
    ORDER BY a.app_code, r.sort_order, r.id
  `

  const rows = await queryRows<ResourceRow[]>(sql, params)

  return {
    success: true,
    data: rows.map(row => ({
      id: row.id,
      appId: row.app_id,
      appCode: row.app_code,
      appName: row.app_name,
      resourceCode: row.resource_code,
      resourceName: row.resource_name,
      description: row.description,
      sortOrder: row.sort_order,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // 生成权限字符串预览
      permissions: [
        `${row.app_code}:${row.resource_code}:view`,
        `${row.app_code}:${row.resource_code}:edit`,
        `${row.app_code}:${row.resource_code}:admin`
      ]
    }))
  }
})
