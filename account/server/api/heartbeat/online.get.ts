/**
 * 查询在线用户（公开端点，通过 Cookie 认证）
 * GET /api/heartbeat/online
 *
 * 返回最近 5 分钟内有心跳的用户列表。
 */

import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface HeartbeatRow extends RowDataPacket {
  uid: string
  source_app: string
  page: string | null
  status: 'active' | 'idle'
  last_seen: string
}

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const query = getQuery(event)
  const sourceApp = query.sourceApp as string | undefined

  let sql = `SELECT uid, source_app, page, status, last_seen
    FROM user_heartbeats
    WHERE last_seen >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`
  const params: unknown[] = []

  if (sourceApp) {
    sql += ' AND source_app = ?'
    params.push(sourceApp)
  }

  sql += ' ORDER BY last_seen DESC'

  const rows = await queryRows<HeartbeatRow[]>(sql, params)

  return {
    success: true,
    data: {
      total: rows.length,
      items: rows.map(r => ({
        uid: r.uid,
        sourceApp: r.source_app,
        page: r.page,
        status: r.status,
        lastSeen: r.last_seen
      }))
    }
  }
})
