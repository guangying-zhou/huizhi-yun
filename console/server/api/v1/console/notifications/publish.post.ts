import { bindAimsNotificationPublisher } from '~~/server/utils/aimsNotificationPublisher'
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
  const physicalActor = assertNotificationPublisherIdentity(serviceActor, binding)
  const input = await readBody(event)
  const actor = bindAimsNotificationPublisher(physicalActor, input)
  const body = await bindPendingNotificationActionTarget(
    event,
    input,
    String(actor.notificationSourceApp || actor.appCode || '')
  )
  return {
    code: 0,
    message: 'success',
    data: await publishPortalNotification(body, actor, event)
  }
})
