import { setHeader } from 'h3'
import { notificationReadQuery } from '@hzy/foundation/shared/utils/notificationReadQuery'
import { getConsoleUserNotifications } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireNotificationUserUid(event)
  return await getConsoleUserNotifications(event, validatedQuery(event))
})

function validatedQuery(event: import('h3').H3Event) {
  try { return notificationReadQuery(getQuery(event)) } catch { throw createError({ statusCode: 400, message: '通知分页参数无效' }) }
}
