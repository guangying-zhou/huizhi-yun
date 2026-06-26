import { getRouterParam } from 'h3'
import { archiveNotification, requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const uid = await requireNotificationUserUid(event)
  const notificationId = getRouterParam(event, 'notificationId') || ''
  return {
    code: 0,
    message: 'success',
    data: await archiveNotification(uid, notificationId)
  }
})
