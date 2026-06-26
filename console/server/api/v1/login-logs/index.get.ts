import type { RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows } from '~~/server/utils/db'

interface CountRow extends RowDataPacket {
  total: number
}

interface LoginLogRow extends RowDataPacket {
  id: number
  uid: string | null
  real_name: string | null
  target_app: string | null
  session_id: string | null
  login_type: string
  login_result: 'success' | 'failed'
  failure_reason: string | null
  ip_address: string | null
  location: string | null
  device: string | null
  browser: string | null
  os: string | null
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
    where.push('(l.uid LIKE ? OR u.real_name LIKE ?)')
    params.push(`%${uid}%`, `%${uid}%`)
  }

  const targetApp = stringValue(query.target_app)
  if (targetApp) {
    where.push('l.target_app = ?')
    params.push(targetApp)
  }

  const sessionId = stringValue(query.session_id)
  if (sessionId) {
    where.push('l.session_id = ?')
    params.push(sessionId)
  }

  const loginResult = stringValue(query.login_result)
  if (loginResult !== '') {
    where.push('l.login_result = ?')
    params.push(loginResult === '1' || loginResult === 'success' ? 'success' : 'failed')
  }

  const loginType = stringValue(query.login_type)
  if (loginType) {
    where.push('l.login_type = ?')
    params.push(loginType)
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
       FROM auth_login_events l
       LEFT JOIN directory_users u ON u.uid = l.uid
      ${whereSql}`,
    params
  )

  const rows = await queryRows<LoginLogRow[]>(
    `SELECT
       l.id,
       l.uid,
       u.real_name,
       l.target_app,
       l.session_id,
       l.login_type,
       l.login_result,
       l.failure_reason,
       l.ip_address,
       l.location,
       l.device_summary AS device,
       l.browser,
       l.os,
       l.created_at
     FROM auth_login_events l
     LEFT JOIN directory_users u ON u.uid = l.uid
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
      items: rows.map(row => ({
        ...row,
        login_result: row.login_result === 'success' ? 1 : 0
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  }
})
