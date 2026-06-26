import { getQuery } from 'h3'
import {
  listUserNotifications,
  requireNotificationUserUid,
  type NotificationStatusFilter
} from '~~/server/utils/notifications'

function queryValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] || '' : value || '').trim()
}

function statusValue(value: unknown): NotificationStatusFilter {
  const normalized = queryValue(value)
  if (['all', 'unread', 'read', 'archived'].includes(normalized)) {
    return normalized as NotificationStatusFilter
  }
  return 'all'
}

export default defineEventHandler(async (event) => {
  const uid = await requireNotificationUserUid(event)
  const query = getQuery(event)
  const data = await listUserNotifications({
    uid,
    status: statusValue(query.status),
    category: queryValue(query.category) || null,
    sourceAppCode: queryValue(query.sourceAppCode || query.source_app_code) || null,
    limit: Number(query.limit || 20),
    cursor: queryValue(query.cursor) || null
  })

  return { code: 0, message: 'success', data }
})
