import type { RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows } from '~~/server/utils/db'

export interface ClipboardInput {
  uid?: string
  content?: string
  contentType?: 'markdown' | 'text' | 'json' | string
  sourceApp?: string
}

export interface HeartbeatInput {
  uid?: string
  sourceApp?: string
  page?: string
  status?: 'active' | 'idle' | 'offline' | string
}

interface ClipboardRow extends RowDataPacket {
  uid: string
  content: string
  content_type: string
  source_app: string | null
  created_at: string
  expires_at: string
}

interface HeartbeatRow extends RowDataPacket {
  uid: string
  source_app: string
  page_path: string | null
  status: string
  last_seen_at: string
}

function nullableString(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export async function setClipboard(input: ClipboardInput) {
  const uid = nullableString(input.uid)
  const content = typeof input.content === 'string' ? input.content : ''
  if (!uid || !content) throw createError({ statusCode: 400, message: 'uid and content are required' })
  if (Buffer.byteLength(content, 'utf8') > 512 * 1024) {
    throw createError({ statusCode: 413, message: 'clipboard content too large' })
  }

  const contentType = nullableString(input.contentType) || 'markdown'
  await execute(
    `INSERT INTO runtime_clipboards (uid, content, content_type, source_app, created_at, expires_at)
     VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 MINUTE))
     ON DUPLICATE KEY UPDATE
       content = VALUES(content),
       content_type = VALUES(content_type),
       source_app = VALUES(source_app),
       created_at = NOW(),
       expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)`,
    [uid, content, contentType, nullableString(input.sourceApp)]
  )
}

export async function getClipboard(uid: string) {
  const normalizedUid = nullableString(uid)
  if (!normalizedUid) throw createError({ statusCode: 400, message: 'uid is required' })

  const row = await queryRow<ClipboardRow>(
    `SELECT uid, content, content_type, source_app, created_at, expires_at
       FROM runtime_clipboards
      WHERE uid = ? AND expires_at > NOW()
      LIMIT 1`,
    [normalizedUid]
  )

  if (!row) return null
  return {
    content: row.content,
    contentType: row.content_type,
    sourceApp: row.source_app,
    createdAt: row.created_at
  }
}

export async function writeHeartbeat(input: HeartbeatInput) {
  const uid = nullableString(input.uid)
  const sourceApp = nullableString(input.sourceApp)
  if (!uid || !sourceApp) throw createError({ statusCode: 400, message: '缺少 uid 或 sourceApp' })

  const status = input.status === 'idle' || input.status === 'offline' ? input.status : 'active'
  await execute(
    `INSERT INTO local_presence_heartbeats (uid, source_app, page_path, status, last_seen_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       page_path = VALUES(page_path),
       status = VALUES(status),
       last_seen_at = NOW()`,
    [uid, sourceApp, nullableString(input.page), status]
  )
}

export async function listOnlineHeartbeats(sourceApp?: string) {
  const params: unknown[] = []
  let sql = `SELECT uid, source_app, page_path, status, last_seen_at
       FROM local_presence_heartbeats
      WHERE last_seen_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`

  const normalizedSourceApp = nullableString(sourceApp)
  if (normalizedSourceApp) {
    sql += ' AND source_app = ?'
    params.push(normalizedSourceApp)
  }

  sql += ' ORDER BY last_seen_at DESC'
  const rows = await queryRows<HeartbeatRow[]>(sql, params)
  const items = rows.map(row => ({
    uid: row.uid,
    sourceApp: row.source_app,
    page: row.page_path,
    status: row.status,
    lastSeen: row.last_seen_at
  }))

  return { total: items.length, items }
}
