import { markAllConsoleUserNotificationsRead } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  await requireNotificationUserUid(event)
  requireIdempotencyKey(event)
  return await markAllConsoleUserNotificationsRead(event, await readBody(event).catch(() => ({})))
})
