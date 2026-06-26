import { getRouterParam } from 'h3'
import { fetchConsoleNotificationsForUser } from '../../../utils/notifications'

export default defineEventHandler(async (event) => {
  const notificationId = encodeURIComponent(getRouterParam(event, 'notificationId') || '')
  const data = await fetchConsoleNotificationsForUser(event, `/api/v1/console/notifications/${notificationId}/archive`, {
    method: 'POST',
    body: {}
  })
  return { code: 0, message: 'success', data }
})
