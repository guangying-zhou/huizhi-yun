import { readBody } from 'h3'
import {
  parseNotificationDetailAuthorizationRequest,
  requireNotificationDetailAuthorizationCaller
} from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import {
  finalizeAimsNotificationDetailAuthorization
} from '~~/server/utils/notificationDetailAuthorization'
import {
  parseAimsNotificationFinalizeBinding
} from '~~/server/utils/notificationDetailAuthorizationResult'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const request = parseNotificationDetailAuthorizationRequest(body)
  const binding = parseAimsNotificationFinalizeBinding(body)
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, {
    scope: 'aims:notification-details:authorize'
  })
  const result = await finalizeAimsNotificationDetailAuthorization(
    event,
    caller,
    request.descriptor,
    request.notificationId,
    binding.challenge,
    binding.decision
  )
  return { code: 0, data: result }
})
