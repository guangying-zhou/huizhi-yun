import { getRouterParam } from 'h3'
import { getUserNotificationDetail } from '~~/server/utils/notificationDetails'
import { requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const uid = await requireNotificationUserUid(event)
  const notificationId = getRouterParam(event, 'notificationId') || ''
  return {
    code: 0,
    message: 'success',
    data: await getUserNotificationDetail(event, uid, notificationId)
  }
})
