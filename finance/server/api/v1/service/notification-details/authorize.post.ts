import { readBody } from 'h3'
import { parseNotificationDetailAuthorizationRequest, requireNotificationDetailAuthorizationCaller } from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import { authorizeFinanceNotificationDetail } from '~~/server/utils/notificationDetailAuthorization'
import { requireFinanceServiceScope } from '~~/server/utils/serviceAuth'

export default defineEventHandler(async (event) => {
  await requireFinanceServiceScope(event, 'finance:notification-details:authorize')
  const request = parseNotificationDetailAuthorizationRequest(await readBody(event))
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, { scope: 'finance:notification-details:authorize' })
  return { code: 0, data: await authorizeFinanceNotificationDetail(event, caller, request.descriptor, request.notificationId) }
})
