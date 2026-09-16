import { fetchConsoleNotificationsForUser, requireConsoleNotificationsUserCredentials } from '../../utils/notifications'

export default defineEventHandler(async (event) => {
  requireConsoleNotificationsUserCredentials(event)
  const body = await readBody(event).catch(() => ({}))
  const data = await fetchConsoleNotificationsForUser(event, '/api/v1/console/notifications/read-all', {
    method: 'POST',
    body
  })
  return { code: 0, message: 'success', data }
})
