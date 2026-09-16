import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { advancePortalActionableLifecycleForService } from '~~/server/utils/notifications'
import { assertNotificationPublisherIdentity } from '~~/server/utils/consoleServiceActor'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'

export default defineEventHandler(async (event) => {
  const actor = assertNotificationPublisherIdentity(
    await requireConsoleServiceActor(event, 'notifications', 'notifications:publish'),
    resolveConsoleRuntimeBinding(event)
  )
  const body = await readBody(event)
  return {
    code: 0,
    message: 'success',
    data: await advancePortalActionableLifecycleForService(body, actor, event)
  }
})
