import { fetchConsoleNotificationsForUser } from '../../utils/notifications'

export default defineEventHandler(async (event) => {
  const data = await fetchConsoleNotificationsForUser(event, '/api/v1/console/notifications/summary')
  return { code: 0, message: 'success', data }
})
