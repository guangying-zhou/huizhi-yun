import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { parseNotificationDetailAuthorizationRequest, requireNotificationDetailAuthorizationCaller } from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import { authorizeAimsNotificationDetail, finalizeAimsNotificationDetailAuthorization } from '../../../server/utils/notificationDetailAuthorization'
import { parseAimsNotificationFinalizeBinding } from '../../../server/utils/notificationDetailAuthorizationResult'

export async function receiveAimsNotificationAuthorization(event: H3Event, body: Record<string, unknown>, finalize = false) {
  if (body.sourceAppCode !== 'aims') throw createError({ statusCode: 403, message: 'Notification owning application mismatch.' })
  const request = parseNotificationDetailAuthorizationRequest(body)
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, { scope: 'enterprise:notification-detail:authorize' })
  if (finalize) {
    const binding = parseAimsNotificationFinalizeBinding(body)
    return { code: 0, data: await finalizeAimsNotificationDetailAuthorization(event, caller, request.descriptor, request.notificationId, binding.challenge, binding.decision, 'enterprise') }
  }
  return { code: 0, data: await authorizeAimsNotificationDetail(event, caller, request.descriptor, request.notificationId, 'enterprise') }
}
