import { notifyIntegrationOperationDeadLetter } from '~~/server/utils/integrationOperationFailureNotifications'
import { requireConsoleServiceActor } from '~~/server/utils/vault'
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
    data: await notifyIntegrationOperationDeadLetter(event, body, actor)
  }
})
