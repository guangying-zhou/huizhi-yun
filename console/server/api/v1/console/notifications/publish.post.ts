import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { publishPortalNotification } from '~~/server/utils/notifications'
import { assertNotificationPublisherIdentity } from '~~/server/utils/consoleServiceActor'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import { bindPendingNotificationActionTarget } from '~~/server/utils/notificationActionTarget'

export default defineEventHandler(async (event) => {
  const actor = assertNotificationPublisherIdentity(
    await requireConsoleServiceActor(event, 'notifications', 'notifications:publish'),
    resolveConsoleRuntimeBinding(event)
  )
  const body = await bindPendingNotificationActionTarget(
    event,
    await readBody(event),
    String(actor.appCode || '')
  )
  return {
    code: 0,
    message: 'success',
    data: await publishPortalNotification(body, actor, event)
  }
})
