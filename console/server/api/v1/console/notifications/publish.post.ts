import { createError } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { publishPortalNotification } from '~~/server/utils/notifications'
import { assertNotificationPublisherIdentity } from '~~/server/utils/consoleServiceActor'
import { resolveNotificationPublisherBinding } from '~~/server/utils/localWorkflowNotificationBinding'
import { bindPendingNotificationActionTarget } from '~~/server/utils/notificationActionTarget'

export default defineEventHandler(async (event) => {
  const serviceActor = await requireConsoleServiceActor(event, 'notifications', 'notifications:publish')
  const binding = resolveNotificationPublisherBinding(event, serviceActor)
  if (!binding) throw createError({ statusCode: 403, message: 'notification_publisher_runtime_binding_mismatch' })
  const actor = assertNotificationPublisherIdentity(serviceActor, binding)
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
