import type { RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows } from '~~/server/utils/db'

interface CountRow extends RowDataPacket {
  total: number
}

interface OperationLogRow extends RowDataPacket {
  id: number
  uid: string | null
  real_name: string | null
  source_app: string
  session_id: string | null
  action: string
  detail: string | null
  ip_address: string | null
  created_at: string
}

function intValue(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = intValue(query.page, 1)
  const pageSize = Math.min(intValue(query.pageSize, 20), 100)
  const offset = (page - 1) * pageSize
  const params: unknown[] = []
  const where: string[] = []

  const uid = stringValue(query.uid)
  if (uid) {
    where.push('(l.actor_id LIKE ? OR u.real_name LIKE ?)')
    params.push(`%${uid}%`, `%${uid}%`)
  }

  const sourceApp = stringValue(query.source_app)
  if (sourceApp) {
    where.push('l.domain_code = ?')
    params.push(sourceApp)
  }

  const sessionId = stringValue(query.session_id)
  if (sessionId) {
    where.push('l.request_id = ?')
    params.push(sessionId)
  }

  const action = stringValue(query.action)
  if (action) {
    where.push('l.action LIKE ?')
    params.push(`%${action}%`)
  }

  const startDate = stringValue(query.start_date)
  if (startDate) {
    where.push('l.created_at >= ?')
    params.push(startDate)
  }

  const endDate = stringValue(query.end_date)
  if (endDate) {
    where.push('l.created_at <= ?')
    params.push(`${endDate} 23:59:59`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const count = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
       FROM operation_logs l
       LEFT JOIN directory_users u ON u.uid = l.actor_id
      ${whereSql}`,
    params
  )

  const rows = await queryRows<OperationLogRow[]>(
    `SELECT
       l.id,
       CASE WHEN l.actor_type = 'human' THEN l.actor_id ELSE NULL END AS uid,
       u.real_name,
       l.domain_code AS source_app,
       l.request_id AS session_id,
       l.action,
       JSON_PRETTY(l.detail_json) AS detail,
       JSON_UNQUOTE(JSON_EXTRACT(l.detail_json, '$.ipAddress')) AS ip_address,
       l.created_at
     FROM operation_logs l
     LEFT JOIN directory_users u ON u.uid = l.actor_id
     ${whereSql}
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const total = Number(count?.total || 0)
  return {
    code: 0,
    message: 'success',
    data: {
      items: rows,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  }
})
