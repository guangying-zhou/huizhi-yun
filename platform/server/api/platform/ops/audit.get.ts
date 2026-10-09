import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface AuditRow extends RowDataPacket {
  id: number
  action: string
  target_type: string
  target_id: string
  target_tenant_code: string | null
  source: string | null
  ip: string | null
  operator_uid: string | null
  operator_name: string | null
  created_at: string
}

interface CountRow extends RowDataPacket { total: number }

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const source = normalizeNullableString(query.source) || 'all'
  const { page, pageSize, offset } = parsePagination(query)
  const where = ['1 = 1']
  const params: Array<string | number> = []

  if (source !== 'all') {
    where.push('pal.source = ?')
    params.push(source)
  }
  if (keyword) {
    where.push('(pal.action LIKE ? OR pal.target_type LIKE ? OR pal.target_id LIKE ? OR COALESCE(pal.target_tenant_code, \'\') LIKE ? OR COALESCE(pa.uid, \'\') LIKE ?)')
    params.push(...Array(5).fill(`%${keyword}%`))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<AuditRow[]>(
    `SELECT pal.id,
            pal.action,
            pal.target_type,
            pal.target_id,
            pal.target_tenant_code,
            pal.source,
            pal.ip,
            pal.created_at,
            pa.uid AS operator_uid,
            pa.display_name AS operator_name
       FROM platform_audit_logs pal
       LEFT JOIN platform_accounts pa ON pa.id = pal.operator_account_id
      ${whereSql}
      ORDER BY pal.created_at DESC, pal.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
       FROM platform_audit_logs pal
       LEFT JOIN platform_accounts pa ON pa.id = pal.operator_account_id
      ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      tenantCode: row.target_tenant_code,
      source: row.source,
      ip: row.ip,
      operatorUid: row.operator_uid,
      operatorName: row.operator_name,
      createdAt: row.created_at
    })),
    total: Number(totalRow?.total || 0),
    page,
    pageSize
  })
})
