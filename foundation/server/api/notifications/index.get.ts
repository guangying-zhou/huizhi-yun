import { getQuery } from 'h3'
import { fetchConsoleNotificationsForUser } from '../../utils/notifications'

export default defineEventHandler(async (event) => {
  const data = await fetchConsoleNotificationsForUser(event, '/api/v1/console/notifications', {
    query: getQuery(event)
  })
  return { code: 0, message: 'success', data }
})
