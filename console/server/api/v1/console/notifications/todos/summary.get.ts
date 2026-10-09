import { getUserTodoSummary, requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  await requireNotificationUserUid(event)
  return {
    code: 0,
    message: 'success',
    data: await getUserTodoSummary(event)
  }
})
