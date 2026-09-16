import { getConsoleUserNotifications } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  await requireNotificationUserUid(event)
  return await getConsoleUserNotifications(event, getQuery(event))
})
