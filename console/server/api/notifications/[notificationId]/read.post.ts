import { mutateConsoleUserNotification } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getRouterParam } from 'h3'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  await requireNotificationUserUid(event)
  requireIdempotencyKey(event)
  return await mutateConsoleUserNotification(event, getRouterParam(event, 'notificationId') || '', 'read')
})
