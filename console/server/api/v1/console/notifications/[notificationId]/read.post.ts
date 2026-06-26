import { getRouterParam } from 'h3'
import { markNotificationRead, requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const uid = await requireNotificationUserUid(event)
  const notificationId = getRouterParam(event, 'notificationId') || ''
  return {
    code: 0,
    message: 'success',
    data: await markNotificationRead(uid, notificationId)
  }
})
