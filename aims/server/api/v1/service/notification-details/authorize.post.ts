import { readBody } from 'h3'
import {
  parseNotificationDetailAuthorizationRequest,
  requireNotificationDetailAuthorizationCaller
} from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import { authorizeAimsNotificationDetail } from '~~/server/utils/notificationDetailAuthorization'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const request = parseNotificationDetailAuthorizationRequest(body)
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, {
    scope: 'aims:notification-details:authorize'
  })
  const result = await authorizeAimsNotificationDetail(event, caller, request.descriptor, request.notificationId)
  return { code: 0, data: result }
})
