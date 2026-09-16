import { createError, readBody } from 'h3'
import { parseNotificationDetailAuthorizationRequest, requireNotificationDetailAuthorizationCaller } from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import { authorizeAltocReceivableNotification } from '~~/server/utils/receivableNotificationDetailAuthorization'
import { ensureAltocConsoleAuth } from '~~/server/utils/authIdentity'
import { requireAltocServiceAuth } from '~~/server/utils/serviceAuthGuard'

const requirement = { scope: 'altoc:notification-details:authorize', allowedApps: ['console'] }
export default defineEventHandler(async (event) => {
  const auth = await ensureAltocConsoleAuth(event) as { scopes?: string[] }
  requireAltocServiceAuth(auth, requirement)
  if (!auth.scopes?.includes(requirement.scope)) {
    throw createError({ statusCode: 403, message: `Missing exact service scope: ${requirement.scope}` })
  }
  const request = parseNotificationDetailAuthorizationRequest(await readBody(event))
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, { scope: requirement.scope })
  return { code: 0, data: await authorizeAltocReceivableNotification(event, caller, request.descriptor, request.notificationId) }
})
