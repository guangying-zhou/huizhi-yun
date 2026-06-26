import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { publishPortalNotification } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'notifications', 'notifications:publish')
  const body = await readBody(event)
  return {
    code: 0,
    message: 'success',
    data: await publishPortalNotification(body, actor)
  }
})
