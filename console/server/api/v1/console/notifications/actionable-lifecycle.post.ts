import { createError } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { advancePortalActionableLifecycleForService } from '~~/server/utils/notifications'
import { assertNotificationPublisherIdentity } from '~~/server/utils/consoleServiceActor'
import { resolveNotificationPublisherBinding } from '~~/server/utils/localWorkflowNotificationBinding'

export default defineEventHandler(async (event) => {
  const serviceActor = await requireConsoleServiceActor(event, 'notifications', 'notifications:publish')
  const binding = resolveNotificationPublisherBinding(event, serviceActor)
  if (!binding) throw createError({ statusCode: 403, message: 'notification_publisher_runtime_binding_mismatch' })
  const actor = assertNotificationPublisherIdentity(serviceActor, binding)
  const body = await readBody(event)
  return {
    code: 0,
    message: 'success',
    data: await advancePortalActionableLifecycleForService(body, actor, event)
  }
})
