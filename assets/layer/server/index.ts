import { createError, type H3Event } from 'h3'
import { parseNotificationDetailAuthorizationRequest, requireNotificationDetailAuthorizationCaller } from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import { authorizeAssetsNotificationDetail } from '../../server/utils/notificationDetailAuthorization'

export async function receiveAssetsNotificationAuthorization(event: H3Event, body: Record<string, unknown>) {
  if (body.sourceAppCode !== 'assets') throw createError({ statusCode: 403, message: 'Notification owning application mismatch.' })
  const request = parseNotificationDetailAuthorizationRequest(body)
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, { scope: 'enterprise:notification-detail:authorize' })
  return { code: 0, data: await authorizeAssetsNotificationDetail(event, caller, request.descriptor, request.notificationId, 'enterprise') }
}
