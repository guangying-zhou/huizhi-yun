import { randomUUID } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { verifyAccessToken } from '~~/server/utils/oidc'
import { resolveOptionalConsoleSession } from '~~/server/utils/authSession'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
export type NotificationStatusFilter = 'all' | 'unread' | 'read' | 'archived'
export type NotificationDeliveryStatus = 'pending' | 'success' | 'failed' | 'skipped'

export interface PublishPortalNotificationInput {
  sourceAppCode?: unknown
  eventType?: unknown
  category?: unknown
  severity?: unknown
  title?: unknown
  summary?: unknown
  body?: unknown
  actionUrl?: unknown
  bizType?: unknown
  bizId?: unknown
  idempotencyKey?: unknown
  recipients?: unknown
  channels?: unknown
  metadata?: unknown
}

interface NotificationRow extends RowDataPacket {
  rowId: number
  notificationId: string
  sourceAppCode: string
  eventType: string | null
  category: string
  severity: NotificationSeverity
  title: string
  summary: string | null
  body: string | null
  actionUrl: string | null
  bizType: string | null
  bizId: string | null
  idempotencyKey: string | null
  metadataJson: string | Record<string, unknown> | null
  createdBy: string | null
  createdAt: string
  expiresAt: string | null
  uid: string
  readAt: string | null
  archivedAt: string | null
  pinnedAt: string | null
  recipientCreatedAt: string
}

interface CountRow extends RowDataPacket {
  count: number
}

interface CategoryCountRow extends RowDataPacket {
  category: string
  count: number
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function nullableString(value: unknown, maxLength?: number) {
  const normalized = stringValue(value)
  if (!normalized) return null
  return maxLength && normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized
}

function normalizeCode(value: unknown, fallback: string, maxLength = 64) {
  const normalized = stringValue(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (normalized || fallback).slice(0, maxLength)
}

function normalizeSeverity(value: unknown): NotificationSeverity {
  const normalized = stringValue(value || 'info').toLowerCase()
  if (['info', 'success', 'warning', 'error'].includes(normalized)) {
    return normalized as NotificationSeverity
  }
  return 'info'
}

function normalizeRecipients(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : stringValue(value).split(/[,\s|]+/)
  return [...new Set(raw.map(item => stringValue(item)).filter(Boolean))]
}

function normalizeChannels(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : stringValue(value).split(/[,\s|]+/)
  const channels = [...new Set(raw.map(item => normalizeCode(item, '', 32)).filter(Boolean))]
  return channels.includes('in_app') ? channels : ['in_app', ...channels]
}

function normalizeDeliveryStatus(value: unknown): NotificationDeliveryStatus {
  const normalized = stringValue(value || 'pending').toLowerCase()
  if (['pending', 'success', 'failed', 'skipped'].includes(normalized)) {
    return normalized as NotificationDeliveryStatus
  }
  return 'pending'
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function bearerToken(value: unknown) {
  const match = stringValue(value).match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function uidFromPayload(payload: Awaited<ReturnType<typeof verifyAccessToken>>) {
  return stringValue((payload.hzy as { uid?: unknown } | undefined)?.uid)
    || stringValue(payload.sub).replace(/^user:/, '')
}

function dateOrNull(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

export async function requireNotificationUserUid(event: H3Event) {
  const authContext = event.context?.consoleAuth as {
    authenticated?: boolean
    subjectType?: string
    uid?: string | null
    token?: string | null
    tokenUse?: string | null
  } | undefined

  if (authContext?.authenticated && authContext.subjectType !== 'service') {
    const uid = stringValue(authContext.uid)
    if (uid) return uid
  }

  const contextToken = authContext?.tokenUse !== 'service' && authContext?.subjectType !== 'service'
    ? stringValue(authContext?.token)
    : ''
  const token = bearerToken(getHeader(event, 'authorization')) || contextToken
  if (token) {
    const payload = await verifyAccessToken(event, token)
    const uid = uidFromPayload(payload)
    if (uid) return uid
  }

  const session = await resolveOptionalConsoleSession(event, { allowLegacyFallback: false })
  if (session?.uid) return session.uid

  throw createError({ statusCode: 401, message: 'Console login required' })
}

function mapNotificationRow(row: NotificationRow) {
  const isRead = Boolean(row.readAt)
  const isArchived = Boolean(row.archivedAt)
  return {
    rowId: row.rowId,
    notificationId: row.notificationId,
    sourceAppCode: row.sourceAppCode,
    eventType: row.eventType,
    category: row.category,
    severity: row.severity,
    title: row.title,
    summary: row.summary,
    body: row.body,
    actionUrl: row.actionUrl,
    bizType: row.bizType,
    bizId: row.bizId,
    idempotencyKey: row.idempotencyKey,
    metadata: typeof row.metadataJson === 'string'
      ? JSON.parse(row.metadataJson || '{}')
      : (row.metadataJson || {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    recipient: {
      uid: row.uid,
      readAt: row.readAt,
      archivedAt: row.archivedAt,
      pinnedAt: row.pinnedAt,
      createdAt: row.recipientCreatedAt,
      isRead,
      isArchived
    }
  }
}

function notificationSelectSql() {
  return `SELECT r.id AS rowId,
                 n.notification_id AS notificationId,
                 n.source_app_code AS sourceAppCode,
                 n.event_type AS eventType,
                 n.category,
                 n.severity,
                 n.title,
                 n.summary,
                 n.body,
                 n.action_url AS actionUrl,
                 n.biz_type AS bizType,
                 n.biz_id AS bizId,
                 n.idempotency_key AS idempotencyKey,
                 n.metadata_json AS metadataJson,
                 n.created_by AS createdBy,
                 n.created_at AS createdAt,
                 n.expires_at AS expiresAt,
                 r.uid,
                 r.read_at AS readAt,
                 r.archived_at AS archivedAt,
                 r.pinned_at AS pinnedAt,
                 r.created_at AS recipientCreatedAt
            FROM portal_notification_recipients r
            INNER JOIN portal_notifications n
               ON n.notification_id = r.notification_id`
}

function statusClause(status: NotificationStatusFilter) {
  if (status === 'unread') return 'r.read_at IS NULL AND r.archived_at IS NULL'
  if (status === 'read') return 'r.read_at IS NOT NULL AND r.archived_at IS NULL'
  if (status === 'archived') return 'r.archived_at IS NOT NULL'
  return 'r.archived_at IS NULL'
}

export async function listUserNotifications(input: {
  uid: string
  status?: NotificationStatusFilter
  category?: string | null
  sourceAppCode?: string | null
  limit?: number
  cursor?: string | number | null
}) {
  const status = input.status || 'all'
  const params: unknown[] = [input.uid]
  const filters = [
    'r.uid = ?',
    '(n.expires_at IS NULL OR n.expires_at > UTC_TIMESTAMP())',
    statusClause(status)
  ]

  const category = nullableString(input.category, 64)
  if (category) {
    filters.push('n.category = ?')
    params.push(category)
  }

  const sourceAppCode = nullableString(input.sourceAppCode, 64)
  if (sourceAppCode) {
    filters.push('n.source_app_code = ?')
    params.push(sourceAppCode)
  }

  const cursor = Number(input.cursor || 0)
  if (Number.isFinite(cursor) && cursor > 0) {
    filters.push('r.id < ?')
    params.push(cursor)
  }

  const limit = Math.min(Math.max(Number(input.limit || 20), 1), 100)
  params.push(limit + 1)

  const rows = await queryRows<NotificationRow[]>(
    `${notificationSelectSql()}
      WHERE ${filters.join('\n        AND ')}
      ORDER BY COALESCE(r.pinned_at, n.created_at) DESC, r.id DESC
      LIMIT ?`,
    params
  )

  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(mapNotificationRow)
  const last = items[items.length - 1]
  return {
    items,
    nextCursor: hasMore && last ? String(last.rowId) : null
  }
}

export async function getUserNotificationSummary(uid: string) {
  const baseWhere = `r.uid = ?
    AND r.archived_at IS NULL
    AND (n.expires_at IS NULL OR n.expires_at > UTC_TIMESTAMP())`

  const [totalRow, unreadRow, categories, latest] = await Promise.all([
    queryRow<CountRow>(
      `SELECT COUNT(*) AS count
         FROM portal_notification_recipients r
         INNER JOIN portal_notifications n ON n.notification_id = r.notification_id
        WHERE ${baseWhere}`,
      [uid]
    ),
    queryRow<CountRow>(
      `SELECT COUNT(*) AS count
         FROM portal_notification_recipients r
         INNER JOIN portal_notifications n ON n.notification_id = r.notification_id
        WHERE ${baseWhere}
          AND r.read_at IS NULL`,
      [uid]
    ),
    queryRows<CategoryCountRow[]>(
      `SELECT n.category, COUNT(*) AS count
         FROM portal_notification_recipients r
         INNER JOIN portal_notifications n ON n.notification_id = r.notification_id
        WHERE ${baseWhere}
          AND r.read_at IS NULL
        GROUP BY n.category
        ORDER BY count DESC, n.category ASC`,
      [uid]
    ),
    listUserNotifications({ uid, status: 'all', limit: 5 })
  ])

  return {
    totalCount: Number(totalRow?.count || 0),
    unreadCount: Number(unreadRow?.count || 0),
    unreadByCategory: categories.reduce<Record<string, number>>((acc, row) => {
      acc[row.category] = Number(row.count || 0)
      return acc
    }, {}),
    latest: latest.items
  }
}

export async function markNotificationRead(uid: string, notificationId: string) {
  const id = stringValue(notificationId)
  if (!id) throw createError({ statusCode: 400, message: 'notificationId is required' })

  const result = await execute<ResultSetHeader>(
    `UPDATE portal_notification_recipients
        SET read_at = COALESCE(read_at, UTC_TIMESTAMP()),
            delivery_state = 'read',
            updated_at = UTC_TIMESTAMP()
      WHERE uid = ?
        AND notification_id = ?`,
    [uid, id]
  )

  if (!result.affectedRows) {
    throw createError({ statusCode: 404, message: 'Notification not found' })
  }

  return { notificationId: id, read: true }
}

export async function archiveNotification(uid: string, notificationId: string) {
  const id = stringValue(notificationId)
  if (!id) throw createError({ statusCode: 400, message: 'notificationId is required' })

  const result = await execute<ResultSetHeader>(
    `UPDATE portal_notification_recipients
        SET read_at = COALESCE(read_at, UTC_TIMESTAMP()),
            archived_at = COALESCE(archived_at, UTC_TIMESTAMP()),
            delivery_state = 'archived',
            updated_at = UTC_TIMESTAMP()
      WHERE uid = ?
        AND notification_id = ?`,
    [uid, id]
  )

  if (!result.affectedRows) {
    throw createError({ statusCode: 404, message: 'Notification not found' })
  }

  return { notificationId: id, archived: true }
}

export async function markAllNotificationsRead(input: {
  uid: string
  category?: unknown
  sourceAppCode?: unknown
}) {
  const params: unknown[] = [input.uid]
  const filters = [
    'r.uid = ?',
    'r.read_at IS NULL',
    'r.archived_at IS NULL',
    '(n.expires_at IS NULL OR n.expires_at > UTC_TIMESTAMP())'
  ]

  const category = nullableString(input.category, 64)
  if (category) {
    filters.push('n.category = ?')
    params.push(category)
  }

  const sourceAppCode = nullableString(input.sourceAppCode, 64)
  if (sourceAppCode) {
    filters.push('n.source_app_code = ?')
    params.push(sourceAppCode)
  }

  const result = await execute<ResultSetHeader>(
    `UPDATE portal_notification_recipients r
      INNER JOIN portal_notifications n ON n.notification_id = r.notification_id
        SET r.read_at = UTC_TIMESTAMP(),
            r.delivery_state = 'read',
            r.updated_at = UTC_TIMESTAMP()
      WHERE ${filters.join('\n        AND ')}`,
    params
  )

  return { updated: result.affectedRows }
}

export async function publishPortalNotification(input: PublishPortalNotificationInput, actor: { actorId?: string | null, appCode?: string | null }) {
  const recipients = normalizeRecipients(input.recipients)
  if (!recipients.length) {
    throw createError({ statusCode: 400, message: 'recipients is required' })
  }

  const sourceAppCode = normalizeCode(input.sourceAppCode || actor.appCode || actor.actorId || 'external', 'external')
  if (actor.appCode && sourceAppCode !== actor.appCode) {
    throw createError({ statusCode: 403, message: 'sourceAppCode 与服务身份不匹配' })
  }

  const title = nullableString(input.title, 255)
  if (!title) throw createError({ statusCode: 400, message: 'title is required' })

  const idempotencyKey = nullableString(input.idempotencyKey, 191)
  const metadata = normalizeMetadata(input.metadata)
  const channels = normalizeChannels(input.channels)

  const result = await withTransaction(async (tx) => {
    let notificationId = ''
    if (idempotencyKey) {
      const existing = await tx.queryRow<RowDataPacket & { notificationId: string }>(
        `SELECT notification_id AS notificationId
           FROM portal_notifications
          WHERE source_app_code = ?
            AND idempotency_key = ?
          LIMIT 1`,
        [sourceAppCode, idempotencyKey]
      )
      notificationId = stringValue(existing?.notificationId)
    }

    if (!notificationId) {
      notificationId = `notif_${randomUUID()}`
      await tx.execute<ResultSetHeader>(
        `INSERT INTO portal_notifications (
           notification_id,
           source_app_code,
           event_type,
           category,
           severity,
           title,
           summary,
           body,
           action_url,
           biz_type,
           biz_id,
           idempotency_key,
           metadata_json,
           created_by,
           expires_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [
          notificationId,
          sourceAppCode,
          nullableString(input.eventType, 128),
          normalizeCode(input.category, 'general'),
          normalizeSeverity(input.severity),
          title,
          nullableString(input.summary, 1000),
          nullableString(input.body),
          nullableString(input.actionUrl, 1000),
          nullableString(input.bizType, 64),
          nullableString(input.bizId, 128),
          idempotencyKey,
          JSON.stringify(metadata),
          nullableString(actor.actorId, 128)
        ]
      )
    }

    for (const uid of recipients) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO portal_notification_recipients (
           notification_id,
           uid,
           delivery_state,
           created_at,
           updated_at
         ) VALUES (?, ?, 'unread', UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           archived_at = NULL,
           delivery_state = CASE WHEN read_at IS NULL THEN 'unread' ELSE 'read' END,
           updated_at = UTC_TIMESTAMP()`,
        [notificationId, uid]
      )
    }

    return { notificationId }
  })

  return {
    notificationId: result.notificationId,
    sourceAppCode,
    recipients,
    channels
  }
}

export async function recordPortalNotificationDelivery(input: {
  notificationId: unknown
  uid: unknown
  channel: unknown
  provider?: unknown
  status?: unknown
  attemptCount?: unknown
  lastError?: unknown
  sentAt?: unknown
}) {
  const notificationId = stringValue(input.notificationId)
  if (!notificationId) throw createError({ statusCode: 400, message: 'notificationId is required' })

  const uid = stringValue(input.uid)
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })

  const channel = normalizeCode(input.channel, '', 32)
  if (!channel) throw createError({ statusCode: 400, message: 'channel is required' })

  const status = normalizeDeliveryStatus(input.status)
  const sentAt = dateOrNull(input.sentAt)
  const attemptCount = Math.max(0, Math.trunc(Number(input.attemptCount || 0)))

  const result = await execute<ResultSetHeader>(
    `INSERT INTO portal_notification_deliveries (
       notification_id,
       uid,
       channel,
       provider,
       status,
       attempt_count,
       last_error,
       sent_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      notificationId,
      uid,
      channel,
      nullableString(input.provider, 64),
      status,
      attemptCount,
      nullableString(input.lastError, 1000),
      sentAt
    ]
  )

  return {
    id: result.insertId,
    notificationId,
    uid,
    channel,
    status
  }
}
