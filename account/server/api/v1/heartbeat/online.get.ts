/**
 * 查询在线用户 API
 * GET /api/v1/heartbeat/online
 *
 * 返回最近有心跳的用户列表，支持按模块过滤。
 * 超过 5 分钟无心跳视为离线（不返回）。
 */

import { verifyApiKey } from '~~/server/utils/api-auth'
import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['用户在线'],
    summary: '查询在线用户',
    description: '返回最近 5 分钟内有心跳的用户列表。支持按 sourceApp 过滤。',
    parameters: [
      { name: 'sourceApp', in: 'query', schema: { type: 'string' }, description: '按模块过滤' }
    ]
  }
})

interface HeartbeatRow extends RowDataPacket {
  uid: string
  source_app: string
  page: string | null
  status: 'active' | 'idle'
  last_seen: string
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

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
