import { getUserNotificationSummary, requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const uid = await requireNotificationUserUid(event)
  return {
    code: 0,
    message: 'success',
    data: await getUserNotificationSummary(uid)
  }
})
