import { markAllNotificationsRead, requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const uid = await requireNotificationUserUid(event)
  const body = await readBody(event).catch(() => ({}))
  return {
    code: 0,
    message: 'success',
    data: await markAllNotificationsRead({
      uid,
      category: body?.category,
      sourceAppCode: body?.sourceAppCode || body?.source_app_code
    })
  }
})
