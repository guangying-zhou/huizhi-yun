import { readBody } from 'h3'
import {
  parseNotificationDetailAuthorizationRequest,
  requireNotificationDetailAuthorizationCaller
} from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import { authorizePeopleNotificationDetail } from '~~/server/utils/notificationDetailAuthorization'
import { requireServiceScope } from '~~/server/utils/serviceAuth'

export default defineEventHandler(async (event) => {
  // Authenticate the Console service capability before reading caller-controlled
  // data or resolving any tenant-runtime binding.
  await requireServiceScope(event, {
    scope: 'people:notification-details:authorize',
    allowedApps: ['console']
  })
  const body = await readBody(event)
  const request = parseNotificationDetailAuthorizationRequest(body)
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, {
    scope: 'people:notification-details:authorize'
  })
  const result = await authorizePeopleNotificationDetail(
    event,
    caller,
    request.descriptor,
    request.notificationId
  )
  return { code: 0, data: result }
})
